package uploads

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/nodes"
	"github.com/mewisme/discloud/internal/postgres"
)

var (
	ErrNotFound       = errors.New("upload session not found")
	ErrForbidden      = errors.New("upload permission denied")
	ErrQuotaExceeded  = errors.New("storage quota exceeded")
	ErrQuotaInvariant = errors.New("storage quota counter invariant violated")
	ErrNameConflict   = errors.New("node name already exists")
	ErrInvalidUpload  = errors.New("invalid upload")
	ErrSessionClosed  = errors.New("upload session is closed")
	ErrSessionExpired = errors.New("upload session expired")
)

type Status string

const (
	StatusOpen       Status = "open"
	StatusCompleting Status = "completing"
	StatusCompleted  Status = "completed"
	StatusCancelled  Status = "cancelled"
	StatusExpired    Status = "expired"
	StatusFailed     Status = "failed"
)

type Actor struct {
	UserID string
	Admin  bool
}

type Session struct {
	ID              string
	ActorUserID     string
	OwnerUserID     string
	ParentFolderID  string
	Name            string
	NameKey         string
	SizeBytes       int64
	ChunkSizeBytes  int64
	ExpectedParts   int
	MIMETypeHint    string
	FileSHA256      []byte
	ReservedBytes   int64
	Status          Status
	CreatedAt       time.Time
	UpdatedAt       time.Time
	ExpiresAt       time.Time
	CompletedAt     *time.Time
	ClosedAt        *time.Time
	CommittedFileID string
}

type CreateInput struct {
	ParentFolderID string
	Name           string
	SizeBytes      int64
	MIMETypeHint   string
	FileSHA256     []byte
}

type Service struct {
	pool              *pgxpool.Pool
	acl               *acl.Service
	defaultChunkSize  int64
	mediaChunkSize    int64
	chunkPlanner      *chunkPlanner
	mediaChunkPlanner *chunkPlanner
	sessionTTL        time.Duration
}

type scanner interface {
	Scan(...any) error
}

const sessionColumns = `
	id::text,
	actor_user_id::text,
	owner_user_id::text,
	parent_folder_id::text,
	name,
	name_key,
	size_bytes,
	chunk_size_bytes,
	expected_parts,
	COALESCE(mime_type_hint, ''),
	file_sha256,
	reserved_bytes,
	status,
	created_at,
	updated_at,
	expires_at,
	completed_at,
	closed_at,
	COALESCE(committed_file_id::text, '')
`

func New(
	pool *pgxpool.Pool,
	chunkSize int64,
	sessionTTL time.Duration,
) *Service {
	return NewWithCapacityProvider(
		pool,
		chunkSize,
		sessionTTL,
		nil,
	)
}

func NewWithCapacityProvider(
	pool *pgxpool.Pool,
	chunkSize int64,
	sessionTTL time.Duration,
	capacity CapacityProvider,
) *Service {
	return NewWithChunkSizes(
		pool,
		chunkSize,
		chunkSize,
		sessionTTL,
		capacity,
	)
}

func NewWithChunkSizes(
	pool *pgxpool.Pool,
	chunkSize int64,
	mediaChunkSize int64,
	sessionTTL time.Duration,
	capacity CapacityProvider,
) *Service {
	return &Service{
		pool:              pool,
		acl:               acl.New(pool),
		defaultChunkSize:  chunkSize,
		mediaChunkSize:    mediaChunkSize,
		chunkPlanner:      newChunkPlanner(chunkSize, capacity),
		mediaChunkPlanner: newMediaChunkPlanner(mediaChunkSize, capacity),
		sessionTTL:        sessionTTL,
	}
}

func (s *Service) Create(
	ctx context.Context,
	actor Actor,
	input CreateInput,
) (Session, error) {
	if input.SizeBytes < 0 ||
		s.defaultChunkSize <= 0 ||
		s.defaultChunkSize > math.MaxInt32 ||
		s.mediaChunkSize <= 0 ||
		s.mediaChunkSize > math.MaxInt32 ||
		s.sessionTTL <= 0 {
		return Session{}, ErrInvalidUpload
	}

	chunkSize := s.defaultChunkSize
	planner := s.chunkPlanner

	if isMediaUpload(input.Name, input.MIMETypeHint) {
		chunkSize = s.mediaChunkSize
		planner = s.mediaChunkPlanner
	}

	if planner != nil {
		chunkSize = planner.Plan(input.SizeBytes)
	}
	if chunkSize <= 0 || chunkSize > math.MaxInt32 {
		return Session{}, ErrInvalidUpload
	}

	name, nameKey, err := nodes.NormalizeName(input.Name)
	if err != nil {
		return Session{}, err
	}

	if len(input.FileSHA256) != 0 && len(input.FileSHA256) != 32 {
		return Session{}, ErrInvalidUpload
	}

	expectedParts, err := partCount(input.SizeBytes, chunkSize)
	if err != nil {
		return Session{}, err
	}

	fileSHA256 := append([]byte(nil), input.FileSHA256...)
	mimeTypeHint := strings.TrimSpace(input.MIMETypeHint)
	expiresAt := time.Now().UTC().Add(s.sessionTTL)

	var session Session

	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		ownerID, err := loadParentOwner(
			ctx,
			tx,
			input.ParentFolderID,
		)
		if err != nil {
			return err
		}

		if err := lockOwnerTree(ctx, tx, ownerID); err != nil {
			return err
		}

		if err := s.requireEdit(
			ctx,
			tx,
			actor,
			input.ParentFolderID,
		); err != nil {
			return err
		}

		var existingKind string
		conflictErr := tx.QueryRow(ctx, `
			SELECT kind
			FROM nodes
			WHERE parent_id::text = $1
			  AND name_key = $2
			  AND deleted_at IS NULL
			LIMIT 1
		`, input.ParentFolderID, nameKey).Scan(&existingKind)
		if conflictErr == nil {
			if existingKind == "file" {
				return ErrFileAlreadyExists
			}
			return ErrNameConflict
		}
		if !errors.Is(conflictErr, pgx.ErrNoRows) {
			return fmt.Errorf("check upload name conflict: %w", conflictErr)
		}

		var (
			quota    *int64
			used     int64
			reserved int64
		)

		err = tx.QueryRow(ctx, `
			SELECT
				storage_quota_bytes,
				storage_used_bytes,
				storage_reserved_bytes
			FROM users
			WHERE id::text = $1
			FOR UPDATE
		`, ownerID).Scan(
			&quota,
			&used,
			&reserved,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock upload owner quota: %w", err)
		}

		if !quotaAllows(quota, used, reserved, input.SizeBytes) {
			return ErrQuotaExceeded
		}

		if _, err := tx.Exec(ctx, `
			UPDATE users
			SET storage_reserved_bytes =
			        storage_reserved_bytes + $2,
			    updated_at = now()
			WHERE id::text = $1
		`, ownerID, input.SizeBytes); err != nil {
			return fmt.Errorf("reserve upload quota: %w", err)
		}

		err = scanSession(tx.QueryRow(ctx, `
			INSERT INTO upload_sessions (
				actor_user_id,
				owner_user_id,
				parent_folder_id,
				name,
				name_key,
				size_bytes,
				chunk_size_bytes,
				expected_parts,
				mime_type_hint,
				file_sha256,
				reserved_bytes,
				expires_at
			)
			VALUES (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4,
				$5,
				$6,
				$7,
				$8,
				NULLIF($9, ''),
				NULLIF($10, '\x'::bytea),
				$6,
				$11
			)
			RETURNING `+sessionColumns,
			actor.UserID,
			ownerID,
			input.ParentFolderID,
			name,
			nameKey,
			input.SizeBytes,
			chunkSize,
			expectedParts,
			mimeTypeHint,
			fileSHA256,
			expiresAt,
		), &session)
		if err != nil {
			return fmt.Errorf("create upload session: %w", err)
		}

		return nil
	})
	if err != nil {
		return Session{}, err
	}

	return session, nil
}

func (s *Service) Get(
	ctx context.Context,
	actor Actor,
	sessionID string,
) (Session, error) {
	var session Session
	err := scanSession(s.pool.QueryRow(ctx, `
		SELECT `+sessionColumns+`
			FROM upload_sessions
			WHERE id::text = $1
		`, sessionID), &session)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("get upload session: %w", err)
	}

	if !actor.Admin && session.ActorUserID != actor.UserID {
		return Session{}, ErrNotFound
	}

	return session, nil
}

func (s *Service) Cancel(
	ctx context.Context,
	actor Actor,
	sessionID string,
) (Session, error) {
	var session Session

	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		var err error

		session, err = loadSessionForUpdate(ctx, tx, sessionID)
		if err != nil {
			return err
		}

		if !actor.Admin && session.ActorUserID != actor.UserID {
			return ErrNotFound
		}

		switch session.Status {
		case StatusCancelled, StatusExpired:
			return nil
		case StatusOpen:
		default:
			return ErrSessionClosed
		}

		if err := releaseReservation(
			ctx,
			tx,
			session.OwnerUserID,
			session.ReservedBytes,
		); err != nil {
			return err
		}

		err = scanSession(tx.QueryRow(ctx, `
			UPDATE upload_sessions
			SET status = 'cancelled',
			    updated_at = now(),
			    closed_at = now()
			WHERE id = $1::uuid
			RETURNING `+sessionColumns,
			session.ID,
		), &session)
		if err != nil {
			return fmt.Errorf("cancel upload session: %w", err)
		}

		return nil
	})
	if err != nil {
		return Session{}, err
	}

	return session, nil
}

func (s *Service) Expire(
	ctx context.Context,
	limit int,
) (int, error) {
	if limit <= 0 {
		return 0, nil
	}
	if limit > 1000 {
		limit = 1000
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id::text
		FROM upload_sessions
		WHERE status = 'open'
		  AND expires_at <= now()
		ORDER BY expires_at, id
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, fmt.Errorf("list expired uploads: %w", err)
	}

	ids := make([]string, 0, limit)

	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan expired upload: %w", err)
		}
		ids = append(ids, id)
	}

	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, fmt.Errorf("read expired uploads: %w", err)
	}

	rows.Close()

	expired := 0

	for _, id := range ids {
		ok, err := s.expireOne(ctx, id)
		if err != nil {
			return expired, err
		}
		if ok {
			expired++
		}
	}

	return expired, nil
}

func (s *Service) expireOne(
	ctx context.Context,
	sessionID string,
) (bool, error) {
	expired := false

	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		session, err := loadSessionForUpdate(ctx, tx, sessionID)
		if errors.Is(err, ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}

		if session.Status != StatusOpen {
			return nil
		}

		var due bool
		if err := tx.QueryRow(
			ctx,
			"SELECT $1::timestamptz <= now()",
			session.ExpiresAt,
		).Scan(&due); err != nil {
			return fmt.Errorf("check upload expiry: %w", err)
		}
		if !due {
			return nil
		}

		if err := releaseReservation(
			ctx,
			tx,
			session.OwnerUserID,
			session.ReservedBytes,
		); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `
			UPDATE upload_sessions
			SET status = 'expired',
			    updated_at = now(),
			    closed_at = now()
			WHERE id = $1::uuid
		`, session.ID); err != nil {
			return fmt.Errorf("expire upload session: %w", err)
		}

		expired = true
		return nil
	})
	if err != nil {
		return false, err
	}

	return expired, nil
}

func (s *Service) requireEdit(
	ctx context.Context,
	tx pgx.Tx,
	actor Actor,
	folderID string,
) error {
	level, err := s.acl.ResolveTx(
		ctx,
		tx,
		folderID,
		actor.UserID,
		actor.Admin,
	)
	if errors.Is(err, acl.ErrNotFound) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if level.Allows(acl.Edit) {
		return nil
	}
	if level == acl.None {
		return ErrNotFound
	}

	return ErrForbidden
}

func loadParentOwner(
	ctx context.Context,
	tx pgx.Tx,
	parentID string,
) (string, error) {
	var ownerID, kind string

	err := tx.QueryRow(ctx, `
		SELECT
			owner_user_id::text,
			kind
		FROM nodes
		WHERE id::text = $1
		  AND deleted_at IS NULL
	`, parentID).Scan(&ownerID, &kind)

	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("load upload parent: %w", err)
	}
	if kind != "folder" {
		return "", ErrNotFound
	}

	return ownerID, nil
}

func loadSessionForUpdate(
	ctx context.Context,
	tx pgx.Tx,
	sessionID string,
) (Session, error) {
	var session Session
	err := scanSession(tx.QueryRow(ctx, `
		SELECT `+sessionColumns+`
		FROM upload_sessions
		WHERE id::text = $1
		FOR UPDATE
	`, sessionID), &session)

	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("lock upload session: %w", err)
	}

	return session, nil
}

func releaseReservation(
	ctx context.Context,
	tx pgx.Tx,
	ownerID string,
	reservedBytes int64,
) error {
	tag, err := tx.Exec(ctx, `
		UPDATE users
		SET storage_reserved_bytes =
		        storage_reserved_bytes - $2,
		    updated_at = now()
		WHERE id::text = $1
		  AND storage_reserved_bytes >= $2
	`, ownerID, reservedBytes)
	if err != nil {
		return fmt.Errorf("release upload reservation: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrQuotaInvariant
	}

	return nil
}

func lockOwnerTree(
	ctx context.Context,
	tx pgx.Tx,
	ownerID string,
) error {
	if _, err := tx.Exec(ctx, `
		SELECT pg_advisory_xact_lock(
			hashtextextended($1, 0)
		)
	`, ownerID); err != nil {
		return fmt.Errorf("lock owner tree: %w", err)
	}

	return nil
}

func quotaAllows(
	quota *int64,
	used int64,
	reserved int64,
	requested int64,
) bool {
	if quota == nil {
		return true
	}

	if used > *quota {
		return false
	}

	remaining := *quota - used
	if reserved > remaining {
		return false
	}

	return requested <= remaining-reserved
}

func partCount(size int64, chunkSize int64) (int, error) {
	if size == 0 {
		return 0, nil
	}

	count := size / chunkSize
	if size%chunkSize != 0 {
		count++
	}

	if count > math.MaxInt32 {
		return 0, ErrInvalidUpload
	}

	return int(count), nil
}

func scanSession(row scanner, dst ...*Session) error {
	if len(dst) != 1 {
		return errors.New("exactly one session destination is required")
	}

	session := dst[0]

	return row.Scan(
		&session.ID,
		&session.ActorUserID,
		&session.OwnerUserID,
		&session.ParentFolderID,
		&session.Name,
		&session.NameKey,
		&session.SizeBytes,
		&session.ChunkSizeBytes,
		&session.ExpectedParts,
		&session.MIMETypeHint,
		&session.FileSHA256,
		&session.ReservedBytes,
		&session.Status,
		&session.CreatedAt,
		&session.UpdatedAt,
		&session.ExpiresAt,
		&session.CompletedAt,
		&session.ClosedAt,
		&session.CommittedFileID,
	)
}
