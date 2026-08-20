package collections

import (
	"context"
	"fmt"
	"time"
)

type SharedCollection struct {
	ID            string
	OwnerUserID   string
	OwnerUsername string
	OwnerName     string
	Name          string
	Description   string
	Level         Level
	SharedAt      time.Time
	UpdatedAt     time.Time
}

func (s *Service) SharedWithUser(ctx context.Context, userID string) ([]SharedCollection, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			c.id::text,
			c.owner_user_id::text,
			owner.username::text,
			owner.name,
			c.name,
			COALESCE(c.description, ''),
			cp.level,
			cp.created_at,
			c.updated_at
		FROM collection_permissions cp
		JOIN collections c ON c.id = cp.collection_id
		JOIN users owner ON owner.id = c.owner_user_id
		WHERE cp.user_id = $1::uuid
		  AND c.deleted_at IS NULL
		ORDER BY cp.created_at DESC, c.id
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list shared collections: %w", err)
	}
	defer rows.Close()

	items := make([]SharedCollection, 0)
	for rows.Next() {
		var item SharedCollection
		var level string
		if err := rows.Scan(
			&item.ID,
			&item.OwnerUserID,
			&item.OwnerUsername,
			&item.OwnerName,
			&item.Name,
			&item.Description,
			&level,
			&item.SharedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan shared collection: %w", err)
		}

		item.Level, err = ParseLevel(level)
		if err != nil {
			return nil, fmt.Errorf("parse shared collection level: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read shared collections: %w", err)
	}
	return items, nil
}
