package acl

import (
	"context"
	"fmt"
	"time"
)

type SharedFolder struct {
	ID            string
	OwnerUserID   string
	OwnerUsername string
	Name          string
	IsRoot        bool
	Level         Level
	SharedAt      time.Time
	UpdatedAt     time.Time
}

func (s *Service) SharedWithUser(ctx context.Context, userID string) ([]SharedFolder, error) {
	rows, err := s.pool.Query(ctx, `
		WITH RECURSIVE active_tree AS (
			SELECT id
			FROM nodes
			WHERE is_root
			  AND deleted_at IS NULL

			UNION ALL

			SELECT child.id
			FROM nodes child
			JOIN active_tree parent ON child.parent_id = parent.id
			WHERE child.deleted_at IS NULL
		)
		SELECT
			n.id::text,
			n.owner_user_id::text,
			owner.username::text,
			n.name,
			n.is_root,
			fp.level,
			fp.created_at,
			n.updated_at
		FROM folder_permissions fp
		JOIN nodes n ON n.id = fp.folder_id
		JOIN active_tree active ON active.id = n.id
		JOIN users owner ON owner.id = n.owner_user_id
		WHERE fp.user_id = $1::uuid
		  AND n.kind = 'folder'
		ORDER BY fp.created_at DESC, n.id
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list shared folders: %w", err)
	}
	defer rows.Close()

	items := make([]SharedFolder, 0)
	for rows.Next() {
		var item SharedFolder
		var level string
		if err := rows.Scan(
			&item.ID,
			&item.OwnerUserID,
			&item.OwnerUsername,
			&item.Name,
			&item.IsRoot,
			&level,
			&item.SharedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan shared folder: %w", err)
		}

		item.Level, err = ParseLevel(level)
		if err != nil {
			return nil, fmt.Errorf("parse shared folder level: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read shared folders: %w", err)
	}
	return items, nil
}
