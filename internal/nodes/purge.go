package nodes

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/postgres"
)

var ErrPurgeActiveUpload = errors.New("active upload targets trash item")

const purgeSubtreeCTE = `
WITH RECURSIVE subtree AS (
	SELECT id, kind
	FROM nodes
	WHERE id = $1::uuid

	UNION ALL

	SELECT child.id, child.kind
	FROM nodes child
	JOIN subtree parent ON child.parent_id = parent.id
)
`

const purgeAffectedUploadsCTE = purgeSubtreeCTE + `,
affected_uploads AS (
	SELECT us.id
	FROM upload_sessions us
	WHERE us.parent_folder_id IN (SELECT id FROM subtree)
	   OR us.committed_file_id IN (SELECT id FROM subtree WHERE kind = 'file')
)
`

func (s *Service) Purge(ctx context.Context, actor Actor, nodeID string) error {
	preliminary, err := loadNodeState(ctx, s.pool, nodeID, false)
	if err != nil {
		return err
	}
	if preliminary.IsRoot {
		return ErrRootImmutable
	}
	if !actor.Admin && actor.UserID != preliminary.OwnerID {
		return ErrNotFound
	}
	if preliminary.DeletedAt == nil {
		return ErrNotDeleted
	}

	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockOwnerTree(ctx, tx, preliminary.OwnerID); err != nil {
			return err
		}

		current, err := loadNodeState(ctx, tx, nodeID, true)
		if err != nil {
			return err
		}
		if current.IsRoot {
			return ErrRootImmutable
		}
		if !actor.Admin && actor.UserID != current.OwnerID {
			return ErrNotFound
		}
		if current.DeletedAt == nil {
			return ErrNotDeleted
		}

		activeUpload, err := purgeHasActiveUpload(ctx, tx, current.ID)
		if err != nil {
			return err
		}
		if activeUpload {
			return ErrPurgeActiveUpload
		}

		var nodeCount, fileCount int64
		if err := tx.QueryRow(ctx, purgeSubtreeCTE+`
SELECT COUNT(*), COUNT(*) FILTER (WHERE kind = 'file')
FROM subtree
`, current.ID).Scan(&nodeCount, &fileCount); err != nil {
			return fmt.Errorf("count purge subtree: %w", err)
		}

		if err := purgeExec(ctx, tx, current.ID, "delete purge upload attempts", purgeAffectedUploadsCTE+`
DELETE FROM chunk_upload_attempts
WHERE upload_session_id IN (SELECT id FROM affected_uploads)
`); err != nil {
			return err
		}
		if err := purgeExec(ctx, tx, current.ID, "delete purge upload parts", purgeAffectedUploadsCTE+`
DELETE FROM upload_parts
WHERE upload_id IN (SELECT id FROM affected_uploads)
`); err != nil {
			return err
		}
		if err := purgeExec(ctx, tx, current.ID, "delete purge upload sessions", purgeAffectedUploadsCTE+`
DELETE FROM upload_sessions
WHERE id IN (SELECT id FROM affected_uploads)
`); err != nil {
			return err
		}
		if err := purgeExec(ctx, tx, current.ID, "delete purge public shares", purgeSubtreeCTE+`
DELETE FROM public_shares
WHERE node_id IN (SELECT id FROM subtree)
`); err != nil {
			return err
		}
		if err := purgeExec(ctx, tx, current.ID, "delete purge collection items", purgeSubtreeCTE+`
DELETE FROM collection_items
WHERE file_id IN (SELECT id FROM subtree WHERE kind = 'file')
`); err != nil {
			return err
		}
		if err := purgeExec(ctx, tx, current.ID, "delete purge folder permissions", purgeSubtreeCTE+`
DELETE FROM folder_permissions
WHERE folder_id IN (SELECT id FROM subtree WHERE kind = 'folder')
`); err != nil {
			return err
		}

		targetChunkIDs := make([]string, 0)
		rows, err := tx.Query(ctx, purgeSubtreeCTE+`,
target_files AS (SELECT id FROM subtree WHERE kind = 'file'),
target_chunks AS (
	SELECT fc.chunk_id
	FROM file_chunks fc
	WHERE fc.file_id IN (SELECT id FROM target_files)

	UNION

	SELECT fvc.chunk_id
	FROM file_version_chunks fvc
	JOIN file_versions fv ON fv.id = fvc.version_id
	WHERE fv.file_id IN (SELECT id FROM target_files)
)
SELECT chunk_id::text
FROM target_chunks
`, current.ID)
		if err != nil {
			return fmt.Errorf("load purge chunks: %w", err)
		}
		for rows.Next() {
			var chunkID string
			if err := rows.Scan(&chunkID); err != nil {
				rows.Close()
				return fmt.Errorf("scan purge chunk: %w", err)
			}
			targetChunkIDs = append(targetChunkIDs, chunkID)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("read purge chunks: %w", err)
		}
		rows.Close()

		if err := purgeExec(ctx, tx, current.ID, "delete purge file chunks", purgeSubtreeCTE+`
DELETE FROM file_chunks
WHERE file_id IN (SELECT id FROM subtree WHERE kind = 'file')
`); err != nil {
			return err
		}
		if err := purgeExec(ctx, tx, current.ID, "delete purge files", purgeSubtreeCTE+`
DELETE FROM files
WHERE node_id IN (SELECT id FROM subtree WHERE kind = 'file')
`); err != nil {
			return err
		}

		tag, err := tx.Exec(ctx, `
DELETE FROM chunks c
WHERE c.id::text = ANY($1::text[])
  AND NOT EXISTS (SELECT 1 FROM file_chunks fc WHERE fc.chunk_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM file_version_chunks fvc WHERE fvc.chunk_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM upload_parts up WHERE up.chunk_id = c.id)
`, targetChunkIDs)
		if err != nil {
			return fmt.Errorf("delete purge chunks: %w", err)
		}
		deletedChunkRows := tag.RowsAffected()

		if err := purgeExec(ctx, tx, current.ID, "delete purge nodes", purgeSubtreeCTE+`
DELETE FROM nodes
WHERE id IN (SELECT id FROM subtree)
`); err != nil {
			return err
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actor.UserID,
			Action:       "node.purge",
			ResourceType: "node",
			ResourceID:   current.ID,
			Metadata: map[string]any{
				"deletedNodeCount": nodeCount,
				"deletedFileCount": fileCount,
				"deletedChunkRows": deletedChunkRows,
				"discordDeleted":   false,
			},
		})
	})
}

func (s *Service) PurgeKind(ctx context.Context, actor Actor, nodeID, kind string) error {
	state, err := loadNodeState(ctx, s.pool, nodeID, false)
	if err != nil {
		return err
	}
	if state.Kind != kind {
		return ErrNotFound
	}
	return s.Purge(ctx, actor, nodeID)
}

func purgeHasActiveUpload(ctx context.Context, tx pgx.Tx, nodeID string) (bool, error) {
	var active bool
	err := tx.QueryRow(ctx, purgeSubtreeCTE+`
SELECT EXISTS (
	SELECT 1
	FROM upload_sessions us
	WHERE us.status IN ('open', 'completing')
	  AND (
			us.parent_folder_id IN (SELECT id FROM subtree)
			OR us.committed_file_id IN (SELECT id FROM subtree WHERE kind = 'file')
	  )
)
`, nodeID).Scan(&active)
	if err != nil {
		return false, fmt.Errorf("check purge uploads: %w", err)
	}
	return active, nil
}

func purgeExec(ctx context.Context, tx pgx.Tx, nodeID, action, query string) error {
	if _, err := tx.Exec(ctx, query, nodeID); err != nil {
		return fmt.Errorf("%s: %w", action, err)
	}
	return nil
}
