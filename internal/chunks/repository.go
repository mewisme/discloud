package chunks

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/blobstore"
)

var ErrNotFound = errors.New("chunk not found")

type Status string

const (
	StatusUncommitted Status = "uncommitted"
	StatusReady       Status = "ready"
)

type Chunk struct {
	ID          string
	SHA256      [32]byte
	SizeBytes   int64
	Location    blobstore.ChunkLocation
	Status      Status
	CreatedAt   time.Time
	CommittedAt *time.Time
}

type RegisterResult struct {
	Chunk   Chunk
	Created bool
}

type Repository struct {
	pool *pgxpool.Pool
}

type scanner interface {
	Scan(...any) error
}

const chunkColumns = `
	id::text,
	sha256,
	size_bytes,
	discord_channel_id,
	discord_message_id,
	discord_attachment_id,
	status,
	created_at,
	committed_at
`

func New(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) FindByDigest(ctx context.Context, sha256 [32]byte, size int64) (Chunk, error) {
	chunk, err := scanChunk(r.pool.QueryRow(ctx, `
		SELECT `+chunkColumns+`
		FROM chunks
		WHERE sha256 = $1
		  AND size_bytes = $2
	`, sha256[:], size))

	if errors.Is(err, pgx.ErrNoRows) {
		return Chunk{}, ErrNotFound
	}
	if err != nil {
		return Chunk{}, fmt.Errorf("find chunk: %w", err)
	}

	return chunk, nil
}

func (r *Repository) Get(ctx context.Context, id string) (Chunk, error) {
	chunk, err := scanChunk(r.pool.QueryRow(ctx, `
		SELECT `+chunkColumns+`
		FROM chunks
		WHERE id = $1::uuid
	`, id))

	if errors.Is(err, pgx.ErrNoRows) {
		return Chunk{}, ErrNotFound
	}
	if err != nil {
		return Chunk{}, fmt.Errorf("get chunk: %w", err)
	}

	return chunk, nil
}

func (r *Repository) Register(
	ctx context.Context,
	sha256 [32]byte,
	size int64,
	location blobstore.ChunkLocation,
) (RegisterResult, error) {
	if size <= 0 ||
		location.DiscordChannelID == "" ||
		location.DiscordMessageID == "" ||
		location.DiscordAttachmentID == "" {
		return RegisterResult{}, blobstore.ErrInvalidChunk
	}

	chunk, err := scanChunk(r.pool.QueryRow(ctx, `
		INSERT INTO chunks (
			sha256,
			size_bytes,
			discord_channel_id,
			discord_message_id,
			discord_attachment_id
		)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (sha256, size_bytes) DO NOTHING
		RETURNING `+chunkColumns,
		sha256[:],
		size,
		location.DiscordChannelID,
		location.DiscordMessageID,
		location.DiscordAttachmentID,
	))

	if err == nil {
		return RegisterResult{
			Chunk:   chunk,
			Created: true,
		}, nil
	}

	if !errors.Is(err, pgx.ErrNoRows) {
		return RegisterResult{}, fmt.Errorf("register chunk: %w", err)
	}

	chunk, err = r.FindByDigest(ctx, sha256, size)
	if err != nil {
		return RegisterResult{}, err
	}

	return RegisterResult{
		Chunk:   chunk,
		Created: false,
	}, nil
}

func (r *Repository) MarkReadyTx(ctx context.Context, tx pgx.Tx, id string) error {
	tag, err := tx.Exec(ctx, `
		UPDATE chunks
		SET status = 'ready',
		    committed_at = COALESCE(committed_at, now())
		WHERE id = $1::uuid
	`, id)
	if err != nil {
		return fmt.Errorf("mark chunk ready: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}

func scanChunk(row scanner) (Chunk, error) {
	var chunk Chunk
	var digest []byte

	err := row.Scan(
		&chunk.ID,
		&digest,
		&chunk.SizeBytes,
		&chunk.Location.DiscordChannelID,
		&chunk.Location.DiscordMessageID,
		&chunk.Location.DiscordAttachmentID,
		&chunk.Status,
		&chunk.CreatedAt,
		&chunk.CommittedAt,
	)
	if err != nil {
		return Chunk{}, err
	}

	if len(digest) != len(chunk.SHA256) {
		return Chunk{}, fmt.Errorf("invalid stored SHA-256 length %d", len(digest))
	}

	copy(chunk.SHA256[:], digest)
	return chunk, nil
}
