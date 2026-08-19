package files

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/blobstore"
)

var (
	ErrNotFound    = errors.New("file not found")
	ErrInvalidSpan = errors.New("invalid file byte span")
)

type Actor struct {
	UserID string
	Admin  bool
}

type File struct {
	ID             string
	OwnerUserID    string
	ParentFolderID string
	Name           string
	SizeBytes      int64
	ChunkSizeBytes int64
	SHA256         []byte
	MIMEType       string
	Extension      string
	Category       string
	Width          *int
	Height         *int
	DurationMS     *int64
	BitrateBPS     *int64
	Codec          string
	Metadata       json.RawMessage
	MetadataStatus string
	MetadataError  string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type Service struct {
	pool  *pgxpool.Pool
	acl   *acl.Service
	blobs blobstore.BlobStore
}

func New(pool *pgxpool.Pool, blobs blobstore.BlobStore) *Service {
	return &Service{pool: pool, acl: acl.New(pool), blobs: blobs}
}

func (s *Service) Get(ctx context.Context, actor Actor, fileID string) (File, error) {
	level, err := s.acl.Resolve(ctx, fileID, actor.UserID, actor.Admin)
	if errors.Is(err, acl.ErrNotFound) || level == acl.None {
		return File{}, ErrNotFound
	}
	if err != nil {
		return File{}, err
	}
	return s.GetStored(ctx, fileID)
}

// GetStored skips ACL; caller must authorize another access context first.
func (s *Service) GetStored(ctx context.Context, fileID string) (File, error) {
	var file File
	var metadata []byte

	err := s.pool.QueryRow(ctx, `
		WITH RECURSIVE chain AS (
			SELECT id, parent_id, deleted_at
			FROM nodes
			WHERE id::text = $1

			UNION ALL

			SELECT parent.id, parent.parent_id, parent.deleted_at
			FROM nodes parent
			JOIN chain child ON child.parent_id = parent.id
		),
		state AS (
			SELECT
				COALESCE(BOOL_AND(deleted_at IS NULL), false) AS active,
				COALESCE(BOOL_OR(parent_id IS NULL), false) AS reaches_root
			FROM chain
		)
		SELECT
			n.id::text,
			n.owner_user_id::text,
			COALESCE(n.parent_id::text, ''),
			n.name,
			f.size_bytes,
			f.chunk_size_bytes,
			f.sha256,
			f.mime_type,
			COALESCE(f.extension, ''),
			f.category,
			f.width,
			f.height,
			f.duration_ms,
			f.bitrate_bps,
			COALESCE(f.codec, ''),
			f.metadata,
			f.metadata_status,
			COALESCE(f.metadata_error, ''),
			n.created_at,
			n.updated_at
		FROM nodes n
		JOIN files f ON f.node_id = n.id
		CROSS JOIN state
		WHERE n.id::text = $1
		  AND n.kind = 'file'
		  AND state.active
		  AND state.reaches_root
	`, fileID).Scan(
		&file.ID,
		&file.OwnerUserID,
		&file.ParentFolderID,
		&file.Name,
		&file.SizeBytes,
		&file.ChunkSizeBytes,
		&file.SHA256,
		&file.MIMEType,
		&file.Extension,
		&file.Category,
		&file.Width,
		&file.Height,
		&file.DurationMS,
		&file.BitrateBPS,
		&file.Codec,
		&metadata,
		&file.MetadataStatus,
		&file.MetadataError,
		&file.CreatedAt,
		&file.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return File{}, ErrNotFound
	}
	if err != nil {
		return File{}, fmt.Errorf("get stored file: %w", err)
	}

	file.Metadata = append(json.RawMessage(nil), metadata...)
	if strings.TrimSpace(file.MIMEType) == "" {
		file.MIMEType = "application/octet-stream"
	}
	return file, nil
}

func (s *Service) Open(ctx context.Context, actor Actor, fileID string, start, length int64) (File, io.ReadCloser, error) {
	file, err := s.Get(ctx, actor, fileID)
	if err != nil {
		return File{}, nil, err
	}
	return s.openFile(ctx, file, start, length)
}

// OpenStored skips ACL; caller must authorize another access context first.
func (s *Service) OpenStored(ctx context.Context, fileID string, start, length int64) (File, io.ReadCloser, error) {
	file, err := s.GetStored(ctx, fileID)
	if err != nil {
		return File{}, nil, err
	}
	return s.openFile(ctx, file, start, length)
}

func (s *Service) openFile(ctx context.Context, file File, start, length int64) (File, io.ReadCloser, error) {
	if start < 0 || length < 0 || start > file.SizeBytes || length > file.SizeBytes-start {
		return File{}, nil, ErrInvalidSpan
	}
	if length == 0 {
		return file, io.NopCloser(strings.NewReader("")), nil
	}
	if s.blobs == nil {
		return File{}, nil, ErrStorageInvariant
	}

	reader, err := newRangeReader(ctx, s, s.blobs, file.ID, file.ChunkSizeBytes, start, length)
	if err != nil {
		return File{}, nil, err
	}
	return file, reader, nil
}
