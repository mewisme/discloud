package adminops

import (
	"context"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/postgres"
)

func (s *Service) Overview(ctx context.Context) (StorageOverview, error) {
	var overview StorageOverview

	err := s.pool.QueryRow(ctx, `
		WITH RECURSIVE active_nodes AS (
			SELECT id, owner_user_id
			FROM nodes
			WHERE is_root
			  AND deleted_at IS NULL

			UNION ALL

			SELECT child.id, child.owner_user_id
			FROM nodes child
			JOIN active_nodes parent ON child.parent_id = parent.id
			WHERE child.deleted_at IS NULL
		),
		active_files AS (
			SELECT active.owner_user_id, f.node_id, f.size_bytes
			FROM active_nodes active
			JOIN files f ON f.node_id = active.id
		),
		derived_used AS (
			SELECT owner_user_id, sum(size_bytes)::bigint AS bytes
			FROM active_files
			GROUP BY owner_user_id
		),
		derived_reserved AS (
			SELECT owner_user_id, sum(reserved_bytes)::bigint AS bytes
			FROM upload_sessions
			WHERE status IN ('open', 'completing')
			GROUP BY owner_user_id
		),
		usage AS (
			SELECT
				u.id,
				u.storage_used_bytes AS cached_used,
				u.storage_reserved_bytes AS cached_reserved,
				COALESCE(du.bytes, 0) AS derived_used,
				COALESCE(dr.bytes, 0) AS derived_reserved
			FROM users u
			LEFT JOIN derived_used du ON du.owner_user_id = u.id
			LEFT JOIN derived_reserved dr ON dr.owner_user_id = u.id
		),
		chunk_stats AS (
			SELECT
				count(*)::bigint AS total_count,
				COALESCE(sum(size_bytes), 0)::bigint AS total_bytes,
				count(*) FILTER (WHERE status = 'ready')::bigint AS ready_count,
				COALESCE(sum(size_bytes) FILTER (WHERE status = 'ready'), 0)::bigint AS ready_bytes,
				count(*) FILTER (WHERE status = 'uncommitted')::bigint AS uncommitted_count,
				COALESCE(sum(size_bytes) FILTER (WHERE status = 'uncommitted'), 0)::bigint AS uncommitted_bytes
			FROM chunks
		),
		orphan_chunks AS (
			SELECT count(*)::bigint AS count, COALESCE(sum(c.size_bytes), 0)::bigint AS bytes
			FROM chunks c
			WHERE c.status = 'uncommitted'
			  AND NOT EXISTS (
					SELECT 1 FROM file_chunks fc WHERE fc.chunk_id = c.id
			  )
			  AND NOT EXISTS (
					SELECT 1 FROM upload_parts up WHERE up.chunk_id = c.id
			  )
		)
		SELECT
			(SELECT count(*)::bigint FROM users),
			(SELECT count(*)::bigint FROM active_files),
			(SELECT COALESCE(sum(size_bytes), 0)::bigint FROM active_files),
			(SELECT COALESCE(sum(cached_used), 0)::bigint FROM usage),
			(SELECT COALESCE(sum(derived_reserved), 0)::bigint FROM usage),
			(SELECT COALESCE(sum(cached_reserved), 0)::bigint FROM usage),
			(SELECT count(*)::bigint FROM usage
			 WHERE cached_used <> derived_used OR cached_reserved <> derived_reserved),
			chunk_stats.total_count,
			chunk_stats.total_bytes,
			chunk_stats.ready_count,
			chunk_stats.ready_bytes,
			chunk_stats.uncommitted_count,
			chunk_stats.uncommitted_bytes,
			orphan_chunks.count,
			orphan_chunks.bytes
		FROM chunk_stats
		CROSS JOIN orphan_chunks
	`).Scan(
		&overview.UserCount,
		&overview.ActiveFileCount,
		&overview.DerivedLogicalUsedBytes,
		&overview.CachedLogicalUsedBytes,
		&overview.DerivedReservedBytes,
		&overview.CachedReservedBytes,
		&overview.QuotaMismatchUsers,
		&overview.UniqueChunkCount,
		&overview.UniqueChunkBytes,
		&overview.ReadyChunkCount,
		&overview.ReadyChunkBytes,
		&overview.UncommittedChunkCount,
		&overview.UncommittedChunkBytes,
		&overview.OrphanCandidateChunkCount,
		&overview.OrphanCandidateChunkBytes,
	)
	if err != nil {
		return StorageOverview{}, fmt.Errorf("get storage overview: %w", err)
	}
	return overview, nil
}

func (s *Service) ReconcileQuota(ctx context.Context, actorUserID, userID string) ([]QuotaReconciliation, error) {
	var reconciled []QuotaReconciliation

	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT
				id::text,
				storage_quota_bytes,
				storage_used_bytes,
				storage_reserved_bytes
			FROM users
			WHERE ($1 = '' OR id = NULLIF($1, '')::uuid)
			ORDER BY id
			FOR UPDATE
		`, userID)
		if isInvalidUUID(err) {
			return ErrInvalidQuery
		}
		if err != nil {
			return fmt.Errorf("lock quota users: %w", err)
		}

		before := make(map[string]QuotaReconciliation)
		for rows.Next() {
			var item QuotaReconciliation
			if err := rows.Scan(
				&item.UserID,
				&item.QuotaBytes,
				&item.BeforeUsedBytes,
				&item.BeforeReservedBytes,
			); err != nil {
				rows.Close()
				return fmt.Errorf("scan quota user: %w", err)
			}
			before[item.UserID] = item
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("read quota users: %w", err)
		}
		rows.Close()

		if userID != "" && len(before) == 0 {
			return ErrUserNotFound
		}

		rows, err = tx.Query(ctx, `
			WITH RECURSIVE active_nodes AS (
				SELECT id, owner_user_id
				FROM nodes
				WHERE is_root
				  AND deleted_at IS NULL
				  AND ($1 = '' OR owner_user_id = NULLIF($1, '')::uuid)

				UNION ALL

				SELECT child.id, child.owner_user_id
				FROM nodes child
				JOIN active_nodes parent ON child.parent_id = parent.id
				WHERE child.deleted_at IS NULL
			),
			derived_used AS (
				SELECT active.owner_user_id, sum(f.size_bytes)::bigint AS bytes
				FROM active_nodes active
				JOIN files f ON f.node_id = active.id
				GROUP BY active.owner_user_id
			),
			derived_reserved AS (
				SELECT owner_user_id, sum(reserved_bytes)::bigint AS bytes
				FROM upload_sessions
				WHERE status IN ('open', 'completing')
				  AND ($1 = '' OR owner_user_id = NULLIF($1, '')::uuid)
				GROUP BY owner_user_id
			)
			UPDATE users u
			SET storage_used_bytes = COALESCE((
					SELECT bytes
					FROM derived_used
					WHERE owner_user_id = u.id
				), 0),
			    storage_reserved_bytes = COALESCE((
					SELECT bytes
					FROM derived_reserved
					WHERE owner_user_id = u.id
				), 0),
			    updated_at = now()
			WHERE ($1 = '' OR u.id = NULLIF($1, '')::uuid)
			RETURNING u.id::text, u.storage_used_bytes, u.storage_reserved_bytes
		`, userID)
		if err != nil {
			return fmt.Errorf("reconcile quota counters: %w", err)
		}
		defer rows.Close()

		var beforeUsedTotal, afterUsedTotal, beforeReservedTotal, afterReservedTotal int64
		var changed int

		for rows.Next() {
			var id string
			var used, reserved int64
			if err := rows.Scan(&id, &used, &reserved); err != nil {
				return fmt.Errorf("scan reconciled quota: %w", err)
			}

			item := before[id]
			item.AfterUsedBytes = used
			item.AfterReservedBytes = reserved
			item.Changed = item.BeforeUsedBytes != used || item.BeforeReservedBytes != reserved
			item.OverQuota = quotaExceeded(item.QuotaBytes, used, reserved)
			if item.Changed {
				changed++
			}

			beforeUsedTotal += item.BeforeUsedBytes
			afterUsedTotal += used
			beforeReservedTotal += item.BeforeReservedBytes
			afterReservedTotal += reserved
			reconciled = append(reconciled, item)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("read reconciled quotas: %w", err)
		}

		sort.Slice(reconciled, func(i, j int) bool {
			return reconciled[i].UserID < reconciled[j].UserID
		})

		event := audit.Event{
			ActorUserID:  actorUserID,
			Action:       "storage.quota_reconcile",
			ResourceType: "storage",
			Metadata: map[string]any{
				"targetUserId":        userID,
				"users":               len(reconciled),
				"changedUsers":        changed,
				"beforeUsedBytes":     beforeUsedTotal,
				"afterUsedBytes":      afterUsedTotal,
				"beforeReservedBytes": beforeReservedTotal,
				"afterReservedBytes":  afterReservedTotal,
			},
		}
		if userID != "" {
			event.ResourceType = "user"
			event.ResourceID = userID
		}
		return audit.Append(ctx, tx, event)
	})
	if err != nil {
		return nil, err
	}
	return reconciled, nil
}

func quotaExceeded(quota *int64, used, reserved int64) bool {
	if quota == nil {
		return false
	}
	if used > *quota {
		return true
	}
	return reserved > *quota-used
}
