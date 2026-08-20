package objects

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/postgres"
)

const (
	DefaultGCGracePeriod   = 24 * time.Hour
	DefaultGCSweepInterval = 15 * time.Minute
	DefaultGCBatchSize     = 100
)

type GCResult struct {
	DeletedObjects int64
	DeletedBytes   int64
	Errors         int64
}

type gcCandidate struct {
	ID        string
	SizeBytes int64
	Location  blobstore.Location
}

func (s *Service) RunGC(ctx context.Context, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}
	runObjectSweep(ctx, s, logger)

	ticker := time.NewTicker(DefaultGCSweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runObjectSweep(ctx, s, logger)
		}
	}
}

func (s *Service) SweepOrphans(ctx context.Context) (GCResult, error) {
	if s == nil || s.pool == nil || s.store == nil {
		return GCResult{}, ErrUnavailable
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id::text
		FROM storage_objects o
		WHERE o.created_at < now() - ($1::bigint * interval '1 millisecond')
		  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_object_id = o.id)
		  AND NOT EXISTS (SELECT 1 FROM file_thumbnails t WHERE t.object_id = o.id)
		ORDER BY o.created_at, o.id
		LIMIT $2
	`, DefaultGCGracePeriod.Milliseconds(), DefaultGCBatchSize)
	if err != nil {
		return GCResult{}, fmt.Errorf("list orphan direct objects: %w", err)
	}
	defer rows.Close()

	ids := make([]string, 0, DefaultGCBatchSize)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return GCResult{}, fmt.Errorf("scan orphan direct object: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return GCResult{}, fmt.Errorf("read orphan direct objects: %w", err)
	}

	var result GCResult
	var sweepErrors []error
	for _, id := range ids {
		var deletedBytes int64
		err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
			var candidate gcCandidate
			err := tx.QueryRow(ctx, `
				SELECT
					o.id::text,
					o.size_bytes,
					o.discord_channel_id,
					o.discord_message_id,
					o.discord_attachment_id
				FROM storage_objects o
				WHERE o.id = $1::uuid
				  AND o.created_at < now() - ($2::bigint * interval '1 millisecond')
				  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_object_id = o.id)
				  AND NOT EXISTS (SELECT 1 FROM file_thumbnails t WHERE t.object_id = o.id)
				FOR UPDATE
			`, id, DefaultGCGracePeriod.Milliseconds()).Scan(
				&candidate.ID,
				&candidate.SizeBytes,
				&candidate.Location.DiscordChannelID,
				&candidate.Location.DiscordMessageID,
				&candidate.Location.DiscordAttachmentID,
			)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			if err != nil {
				return fmt.Errorf("lock orphan direct object: %w", err)
			}

			if err := s.store.DeleteObject(ctx, candidate.Location); err != nil {
				return fmt.Errorf("delete Discord direct object %s: %w", candidate.ID, err)
			}
			if _, err := tx.Exec(ctx, "DELETE FROM storage_objects WHERE id = $1::uuid", candidate.ID); err != nil {
				return fmt.Errorf("delete direct object row: %w", err)
			}
			deletedBytes = candidate.SizeBytes
			return nil
		})
		if err != nil {
			result.Errors++
			sweepErrors = append(sweepErrors, err)
			continue
		}
		if deletedBytes > 0 {
			result.DeletedObjects++
			result.DeletedBytes += deletedBytes
		}
	}
	return result, errors.Join(sweepErrors...)
}

func runObjectSweep(ctx context.Context, service *Service, logger *slog.Logger) {
	result, err := service.SweepOrphans(ctx)
	if err != nil && ctx.Err() == nil {
		logger.Warn("orphan direct object sweep completed with errors", "deleted_objects", result.DeletedObjects, "deleted_bytes", result.DeletedBytes, "errors", result.Errors, "error", err)
		return
	}
	if result.DeletedObjects > 0 {
		logger.Info("orphan direct object sweep completed", "deleted_objects", result.DeletedObjects, "deleted_bytes", result.DeletedBytes)
	}
}
