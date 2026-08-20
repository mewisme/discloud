package objects

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/blobstore"
)

const (
	DefaultMaxSize  int64 = 10 * 1024 * 1024
	HardMaxSize     int64 = 20 * 1024 * 1024
	urlSafetyWindow       = time.Minute
)

var (
	ErrUnavailable     = errors.New("direct object storage unavailable")
	ErrTooLarge        = errors.New("direct object exceeds maximum size")
	ErrEmpty           = errors.New("direct object is empty")
	ErrInvalidFilename = errors.New("invalid direct object filename")
	ErrInvalidKind     = errors.New("invalid direct object kind")
	ErrNotFound        = errors.New("direct object not found")
)

type Object struct {
	ID                  string
	Kind                string
	SHA256              [32]byte
	SizeBytes           int64
	MIMEType            string
	Filename            string
	Location            blobstore.Location
	UploadedByBotUserID string
	CreatedAt           time.Time
}

type Service struct {
	pool    *pgxpool.Pool
	store   blobstore.DirectObjectStore
	maxSize int64
}

func New(pool *pgxpool.Pool, store blobstore.DirectObjectStore, maxSize int64) *Service {
	if maxSize <= 0 {
		maxSize = DefaultMaxSize
	}
	if maxSize > HardMaxSize {
		maxSize = HardMaxSize
	}
	return &Service{pool: pool, store: store, maxSize: maxSize}
}

func (s *Service) MaxSize() int64 {
	if s == nil {
		return 0
	}
	return s.maxSize
}

func (s *Service) Put(ctx context.Context, kind, filename, mimeType string, src io.Reader) (Object, error) {
	if s == nil || s.pool == nil || s.store == nil || src == nil {
		return Object{}, ErrUnavailable
	}
	kind = strings.TrimSpace(kind)
	switch kind {
	case "avatar", "thumbnail", "other":
	default:
		return Object{}, ErrInvalidKind
	}

	filename = filepath.Base(strings.TrimSpace(filename))
	if filename == "" || filename == "." || filename == string(filepath.Separator) {
		return Object{}, ErrInvalidFilename
	}
	mimeType = strings.TrimSpace(mimeType)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	file, size, digest, err := spool(src, s.maxSize)
	if err != nil {
		return Object{}, err
	}
	defer func() {
		_ = file.Close()
		_ = os.Remove(file.Name())
	}()

	put, err := s.store.PutObject(ctx, filename, file, size, digest)
	if err != nil {
		return Object{}, err
	}

	var object Object
	object.Kind = kind
	object.SHA256 = digest
	object.SizeBytes = size
	object.MIMEType = mimeType
	object.Filename = filename
	object.Location = put.Location
	object.UploadedByBotUserID = put.BotUserID
	var cachedURL any
	var cachedExpiresAt any
	if rawURL := strings.TrimSpace(put.AttachmentURL); rawURL != "" && !put.AttachmentURLExpiresAt.IsZero() {
		cachedURL = rawURL
		cachedExpiresAt = put.AttachmentURLExpiresAt.UTC()
	}
	err = s.pool.QueryRow(ctx, `
	INSERT INTO storage_objects (
		kind,
		sha256,
		size_bytes,
		mime_type,
		filename,
		discord_channel_id,
		discord_message_id,
		discord_attachment_id,
		uploaded_by_bot_user_id,
		cached_cdn_url,
		cached_cdn_url_expires_at
	)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	RETURNING id::text, created_at
`, kind, digest[:], size, mimeType, filename,
		put.Location.DiscordChannelID,
		put.Location.DiscordMessageID,
		put.Location.DiscordAttachmentID,
		put.BotUserID,
		cachedURL,
		cachedExpiresAt,
	).Scan(&object.ID, &object.CreatedAt)
	if err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		_ = s.store.DeleteObject(cleanupCtx, put.Location)
		cancel()
		return Object{}, fmt.Errorf("register direct object: %w", err)
	}

	return object, nil
}

func (s *Service) ResolveURL(ctx context.Context, objectID string) (string, error) {
	if s == nil || s.pool == nil || s.store == nil {
		return "", ErrUnavailable
	}

	var location blobstore.Location
	var cachedURL *string
	var cachedExpiresAt *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT
			discord_channel_id,
			discord_message_id,
			discord_attachment_id,
			cached_cdn_url,
			cached_cdn_url_expires_at
		FROM storage_objects
		WHERE id = $1::uuid
	`, objectID).Scan(
		&location.DiscordChannelID,
		&location.DiscordMessageID,
		&location.DiscordAttachmentID,
		&cachedURL,
		&cachedExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("load direct object: %w", err)
	}

	now := time.Now().UTC()
	if cachedURL != nil && cachedExpiresAt != nil && cachedExpiresAt.After(now.Add(urlSafetyWindow)) {
		return *cachedURL, nil
	}

	rawURL, expiresAt, err := s.store.ResolveAttachmentURL(ctx, location)
	if err != nil {
		return "", err
	}

	if !expiresAt.IsZero() {
		_, _ = s.pool.Exec(ctx, `
			UPDATE storage_objects
			SET cached_cdn_url = $2,
			    cached_cdn_url_expires_at = $3,
			    updated_at = now()
			WHERE id = $1::uuid
		`, objectID, rawURL, expiresAt)
	}
	return rawURL, nil
}

func spool(src io.Reader, maxSize int64) (*os.File, int64, [32]byte, error) {
	file, err := os.CreateTemp("", "discloud-object-*")
	if err != nil {
		return nil, 0, [32]byte{}, fmt.Errorf("create direct object spool: %w", err)
	}
	cleanup := func() {
		_ = file.Close()
		_ = os.Remove(file.Name())
	}

	hash := sha256.New()
	size, err := io.Copy(file, io.TeeReader(io.LimitReader(src, maxSize+1), hash))
	if err != nil {
		cleanup()
		return nil, 0, [32]byte{}, fmt.Errorf("spool direct object: %w", err)
	}
	if size == 0 {
		cleanup()
		return nil, 0, [32]byte{}, ErrEmpty
	}
	if size > maxSize {
		cleanup()
		return nil, 0, [32]byte{}, ErrTooLarge
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, 0, [32]byte{}, fmt.Errorf("rewind direct object: %w", err)
	}

	var digest [32]byte
	copy(digest[:], hash.Sum(nil))
	return file, size, digest, nil
}
