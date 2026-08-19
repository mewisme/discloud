package nodes

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/postgres"
)

var (
	ErrNotDeleted     = errors.New("node is not directly deleted")
	ErrQuotaExceeded  = errors.New("storage quota exceeded")
	ErrQuotaInvariant = errors.New("storage quota invariant violated")
	ErrRestoreTarget  = errors.New("restore destination is unavailable")
)

type RestoreInput struct {
	ParentID string
	Name     string
}

type nodeState struct {
	Node
	DeletedAt *time.Time
}

func (s *Service) Trash(ctx context.Context, actor Actor, nodeID string) error {
	preliminary, err := loadNode(ctx, s.pool, nodeID, false)
	if err != nil {
		return err
	}
	if preliminary.IsRoot {
		return ErrRootImmutable
	}

	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockOwnerTree(ctx, tx, preliminary.OwnerID); err != nil {
			return err
		}

		current, err := loadNode(ctx, tx, nodeID, true)
		if err != nil {
			return err
		}
		if current.IsRoot {
			return ErrRootImmutable
		}
		if err := s.requireTx(ctx, tx, actor, current.ID, acl.Edit); err != nil {
			return err
		}

		bytes, err := activeSubtreeBytes(ctx, tx, current.ID, false)
		if err != nil {
			return err
		}
		if err := subtractUsedBytes(ctx, tx, current.OwnerID, bytes); err != nil {
			return err
		}

		tag, err := tx.Exec(ctx, `
			UPDATE nodes
			SET deleted_at = now(), deleted_by = $2::uuid, updated_at = now()
			WHERE id = $1::uuid
			  AND deleted_at IS NULL
		`, current.ID, actor.UserID)
		if err != nil {
			return fmt.Errorf("trash node: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrNotFound
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actor.UserID,
			Action:       "node.trash",
			ResourceType: "node",
			ResourceID:   current.ID,
			Metadata: map[string]any{
				"releasedBytes": bytes,
			},
		})
	})
}

func (s *Service) Restore(ctx context.Context, actor Actor, nodeID string, input RestoreInput) (Node, error) {
	preliminary, err := loadNodeState(ctx, s.pool, nodeID, false)
	if err != nil {
		return Node{}, err
	}
	if preliminary.IsRoot {
		return Node{}, ErrRootImmutable
	}
	if preliminary.DeletedAt == nil {
		return Node{}, ErrNotDeleted
	}

	var restored Node
	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
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
		if current.DeletedAt == nil {
			return ErrNotDeleted
		}

		if !actor.Admin && actor.UserID != current.OwnerID {
			if err := s.requireTx(ctx, tx, actor, current.ParentID, acl.Edit); err != nil {
				return err
			}
		}

		parentID := current.ParentID
		if input.ParentID != "" {
			parentID = input.ParentID
		}

		parent, err := loadNode(ctx, tx, parentID, true)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				return ErrRestoreTarget
			}
			return err
		}
		if parent.Kind != "folder" {
			return ErrNotFolder
		}
		if parent.OwnerID != current.OwnerID {
			if actor.Admin {
				return ErrCrossOwner
			}
			return ErrNotFound
		}
		if err := s.requireTx(ctx, tx, actor, parent.ID, acl.Edit); err != nil {
			if errors.Is(err, ErrNotFound) {
				return ErrRestoreTarget
			}
			return err
		}

		if current.Kind == "folder" {
			cycle, err := folderContains(ctx, tx, parent.ID, current.ID)
			if err != nil {
				return err
			}
			if cycle {
				return ErrCycle
			}
		}

		name, nameKey := current.Name, current.NameKey
		if input.Name != "" {
			name, nameKey, err = NormalizeName(input.Name)
			if err != nil {
				return err
			}
		}

		conflict, err := activeNameExists(ctx, tx, parent.ID, nameKey)
		if err != nil {
			return err
		}
		if conflict {
			return ErrNameConflict
		}

		bytes, err := activeSubtreeBytes(ctx, tx, current.ID, true)
		if err != nil {
			return err
		}
		if err := addUsedBytes(ctx, tx, current.OwnerID, bytes); err != nil {
			return err
		}

		err = tx.QueryRow(ctx, `
			UPDATE nodes
			SET parent_id = $2::uuid,
			    name = $3,
			    name_key = $4,
			    deleted_at = NULL,
			    deleted_by = NULL,
			    updated_at = now()
			WHERE id = $1::uuid
			  AND deleted_at IS NOT NULL
			RETURNING `+nodeColumns,
			current.ID, parent.ID, name, nameKey,
		).Scan(
			&restored.ID,
			&restored.Kind,
			&restored.OwnerID,
			&restored.ParentID,
			&restored.Name,
			&restored.NameKey,
			&restored.IsRoot,
			&restored.IsFavorite,
			&restored.CreatedAt,
			&restored.UpdatedAt,
		)
		if err != nil {
			if isUniqueViolation(err) {
				return ErrNameConflict
			}
			return fmt.Errorf("restore node: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actor.UserID,
			Action:       "node.restore",
			ResourceType: "node",
			ResourceID:   restored.ID,
			Metadata: map[string]any{
				"restoredBytes": bytes,
				"parentId":      parent.ID,
			},
		})
	})
	if err != nil {
		return Node{}, err
	}
	return restored, nil
}

func (s *Service) TrashKind(ctx context.Context, actor Actor, nodeID, kind string) error {
	state, err := loadNodeState(ctx, s.pool, nodeID, false)
	if err != nil {
		return err
	}
	if state.Kind != kind {
		return ErrNotFound
	}
	return s.Trash(ctx, actor, nodeID)
}

func (s *Service) RestoreKind(ctx context.Context, actor Actor, nodeID, kind string, input RestoreInput) (Node, error) {
	state, err := loadNodeState(ctx, s.pool, nodeID, false)
	if err != nil {
		return Node{}, err
	}
	if state.Kind != kind {
		return Node{}, ErrNotFound
	}
	return s.Restore(ctx, actor, nodeID, input)
}

func activeSubtreeBytes(ctx context.Context, tx pgx.Tx, nodeID string, includeDeletedRoot bool) (int64, error) {
	rootPredicate := "deleted_at IS NULL"
	if includeDeletedRoot {
		rootPredicate = "TRUE"
	}

	var bytes int64
	err := tx.QueryRow(ctx, `
		WITH RECURSIVE subtree AS (
			SELECT id
			FROM nodes
			WHERE id = $1::uuid
			  AND `+rootPredicate+`

			UNION ALL

			SELECT child.id
			FROM nodes child
			JOIN subtree parent ON child.parent_id = parent.id
			WHERE child.deleted_at IS NULL
		)
		SELECT COALESCE(SUM(files.size_bytes), 0)
		FROM subtree
		JOIN files ON files.node_id = subtree.id
	`, nodeID).Scan(&bytes)
	if err != nil {
		return 0, fmt.Errorf("calculate subtree bytes: %w", err)
	}
	return bytes, nil
}

func subtractUsedBytes(ctx context.Context, tx pgx.Tx, ownerID string, bytes int64) error {
	var used int64
	if err := tx.QueryRow(ctx, `
		SELECT storage_used_bytes
		FROM users
		WHERE id = $1::uuid
		FOR UPDATE
	`, ownerID).Scan(&used); err != nil {
		return fmt.Errorf("lock owner quota: %w", err)
	}
	if bytes < 0 || used < bytes {
		return ErrQuotaInvariant
	}

	if _, err := tx.Exec(ctx, `
		UPDATE users
		SET storage_used_bytes = storage_used_bytes - $2, updated_at = now()
		WHERE id = $1::uuid
	`, ownerID, bytes); err != nil {
		return fmt.Errorf("release used quota: %w", err)
	}
	return nil
}

func addUsedBytes(ctx context.Context, tx pgx.Tx, ownerID string, bytes int64) error {
	var quota *int64
	var used, reserved int64

	if err := tx.QueryRow(ctx, `
		SELECT storage_quota_bytes, storage_used_bytes, storage_reserved_bytes
		FROM users
		WHERE id = $1::uuid
		FOR UPDATE
	`, ownerID).Scan(&quota, &used, &reserved); err != nil {
		return fmt.Errorf("lock owner quota: %w", err)
	}
	if bytes < 0 {
		return ErrQuotaInvariant
	}
	if !quotaAllowsRestore(quota, used, reserved, bytes) {
		return ErrQuotaExceeded
	}

	if _, err := tx.Exec(ctx, `
		UPDATE users
		SET storage_used_bytes = storage_used_bytes + $2, updated_at = now()
		WHERE id = $1::uuid
	`, ownerID, bytes); err != nil {
		return fmt.Errorf("consume restore quota: %w", err)
	}
	return nil
}

func quotaAllowsRestore(quota *int64, used, reserved, bytes int64) bool {
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
	return bytes <= remaining-reserved
}

func activeNameExists(ctx context.Context, tx pgx.Tx, parentID, nameKey string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM nodes
			WHERE parent_id = $1::uuid
			  AND name_key = $2
			  AND deleted_at IS NULL
		)
	`, parentID, nameKey).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check restore name conflict: %w", err)
	}
	return exists, nil
}

func loadNodeState(ctx context.Context, db queryRower, nodeID string, lock bool) (nodeState, error) {
	query := `
		SELECT ` + nodeColumns + `, deleted_at
		FROM nodes
		WHERE id = $1::uuid
	`
	if lock {
		query += " FOR UPDATE"
	}

	var state nodeState
	err := db.QueryRow(ctx, query, nodeID).Scan(
		&state.ID,
		&state.Kind,
		&state.OwnerID,
		&state.ParentID,
		&state.Name,
		&state.NameKey,
		&state.IsRoot,
		&state.IsFavorite,
		&state.CreatedAt,
		&state.UpdatedAt,
		&state.DeletedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return nodeState{}, ErrNotFound
	}
	if err != nil {
		return nodeState{}, fmt.Errorf("load node state: %w", err)
	}
	return state, nil
}
