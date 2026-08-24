package orphangc

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/chunks"
	"github.com/mewisme/discloud/internal/postgres"
)

const (
	DefaultGracePeriod   = 24 * time.Hour
	DefaultSweepInterval = 15 * time.Minute
	DefaultBatchSize     = 100
)

type Result struct {
	DeletedChunks int64
	DeletedBytes  int64
	Errors        int64
}

type candidate struct {
	ID        string
	SHA256    [32]byte
	SizeBytes int64
	Location  blobstore.ChunkLocation
}

type Service struct {
	pool     *pgxpool.Pool
	chunks   *chunks.Repository
	blobs    blobstore.TechnicalBlobStore
	logger   *slog.Logger
	grace    time.Duration
	batch    int
	interval time.Duration
}

func New(pool *pgxpool.Pool, blobs blobstore.TechnicalBlobStore, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		pool:     pool,
		chunks:   chunks.New(pool),
		blobs:    blobs,
		logger:   logger,
		grace:    DefaultGracePeriod,
		batch:    DefaultBatchSize,
		interval: DefaultSweepInterval,
	}
}

func (s *Service) Run(ctx context.Context) {
	s.runSweep(ctx)

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.runSweep(ctx)
		}
	}
}

func (s *Service) Sweep(ctx context.Context) (Result, error) {
	if s == nil || s.pool == nil || s.chunks == nil || s.blobs == nil {
		return Result{}, errors.New("orphan cleanup is unavailable")
	}

	candidates, err := s.listCandidates(ctx)
	if err != nil {
		return Result{}, err
	}

	var result Result
	var sweepErrors []error

	for _, item := range candidates {
		err := s.chunks.WithDigestLock(ctx, item.SHA256, item.SizeBytes, func() error {
			current, err := s.loadCandidate(ctx, item.ID)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			if err != nil {
				return err
			}

			if err := s.blobs.DeleteChunk(ctx, current.Location); err != nil {
				return fmt.Errorf("delete Discord orphan chunk %s: %w", current.ID, err)
			}

			bytes, deleted, err := s.removeCandidate(ctx, current.ID)
			if err != nil {
				return err
			}
			if deleted {
				result.DeletedChunks++
				result.DeletedBytes += bytes
			}
			return nil
		})
		if err != nil {
			result.Errors++
			sweepErrors = append(sweepErrors, err)
			s.logger.Warn(
				"orphan chunk cleanup failed",
				"chunk_id", item.ID,
				"error", err,
			)
		}
	}

	return result, errors.Join(sweepErrors...)
}

func (s *Service) runSweep(ctx context.Context) {
	result, err := s.Sweep(ctx)
	if err != nil && ctx.Err() == nil {
		s.logger.Warn(
			"orphan chunk sweep completed with errors",
			"deleted_chunks", result.DeletedChunks,
			"deleted_bytes", result.DeletedBytes,
			"errors", result.Errors,
			"error", err,
		)
		return
	}
	if result.DeletedChunks > 0 {
		s.logger.Info(
			"orphan chunk sweep completed",
			"deleted_chunks", result.DeletedChunks,
			"deleted_bytes", result.DeletedBytes,
		)
	}
}

func (s *Service) listCandidates(ctx context.Context) ([]candidate, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			c.id::text,
			c.sha256,
			c.size_bytes,
			c.discord_channel_id,
			c.discord_message_id,
			c.discord_attachment_id
		FROM chunks c
		WHERE c.status = 'uncommitted'
		  AND c.created_at < now() - ($1::bigint * interval '1 millisecond')
		  AND NOT EXISTS (
				SELECT 1
				FROM file_chunks fc
				WHERE fc.chunk_id = c.id
		  )
		  AND NOT EXISTS (
				SELECT 1 FROM file_version_chunks fvc WHERE fvc.chunk_id = c.id
		  )
		  AND NOT EXISTS (
				SELECT 1
				FROM upload_parts up
				JOIN upload_sessions us ON us.id = up.upload_id
				WHERE up.chunk_id = c.id
				  AND us.status IN ('open', 'completing')
		  )
		ORDER BY c.created_at, c.id
		LIMIT $2
	`, s.grace.Milliseconds(), s.batch)
	if err != nil {
		return nil, fmt.Errorf("list orphan chunks: %w", err)
	}
	defer rows.Close()

	result := make([]candidate, 0)
	for rows.Next() {
		item, err := scanCandidate(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read orphan chunks: %w", err)
	}
	return result, nil
}

func (s *Service) loadCandidate(ctx context.Context, id string) (candidate, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT
			c.id::text,
			c.sha256,
			c.size_bytes,
			c.discord_channel_id,
			c.discord_message_id,
			c.discord_attachment_id
		FROM chunks c
		WHERE c.id = $1::uuid
		  AND c.status = 'uncommitted'
		  AND c.created_at < now() - ($2::bigint * interval '1 millisecond')
		  AND NOT EXISTS (
				SELECT 1
				FROM file_chunks fc
				WHERE fc.chunk_id = c.id
		  )
		  AND NOT EXISTS (
				SELECT 1 FROM file_version_chunks fvc WHERE fvc.chunk_id = c.id
		  )
		  AND NOT EXISTS (
				SELECT 1
				FROM upload_parts up
				JOIN upload_sessions us ON us.id = up.upload_id
				WHERE up.chunk_id = c.id
				  AND us.status IN ('open', 'completing')
		  )
	`, id, s.grace.Milliseconds())

	return scanCandidate(row)
}

func (s *Service) removeCandidate(ctx context.Context, id string) (int64, bool, error) {
	var deletedBytes int64
	deleted := false

	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			DELETE FROM upload_parts up
			USING upload_sessions us
			WHERE up.upload_id = us.id
			  AND up.chunk_id = $1::uuid
			  AND us.status NOT IN ('open', 'completing')
		`, id); err != nil {
			return fmt.Errorf("remove closed upload references: %w", err)
		}

		err := tx.QueryRow(ctx, `
			DELETE FROM chunks c
			WHERE c.id = $1::uuid
			  AND c.status = 'uncommitted'
			  AND NOT EXISTS (
					SELECT 1
					FROM file_chunks fc
					WHERE fc.chunk_id = c.id
			  )
			  AND NOT EXISTS (
					SELECT 1 FROM file_version_chunks fvc WHERE fvc.chunk_id = c.id
			  )
			  AND NOT EXISTS (
					SELECT 1
					FROM upload_parts up
					JOIN upload_sessions us ON us.id = up.upload_id
					WHERE up.chunk_id = c.id
					  AND us.status IN ('open', 'completing')
			  )
			RETURNING c.size_bytes
		`, id).Scan(&deletedBytes)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("delete orphan chunk row: %w", err)
		}

		deleted = true
		return nil
	})
	if err != nil {
		return 0, false, err
	}

	return deletedBytes, deleted, nil
}

func scanCandidate(row interface{ Scan(...any) error }) (candidate, error) {
	var item candidate
	var digest []byte

	err := row.Scan(
		&item.ID,
		&digest,
		&item.SizeBytes,
		&item.Location.DiscordChannelID,
		&item.Location.DiscordMessageID,
		&item.Location.DiscordAttachmentID,
	)
	if err != nil {
		return candidate{}, err
	}
	if len(digest) != len(item.SHA256) {
		return candidate{}, fmt.Errorf("invalid orphan chunk SHA-256 length %d", len(digest))
	}

	copy(item.SHA256[:], digest)
	return item, nil
}
