package collections

import (
	"context"
	"fmt"
)

func (s *Service) AccessLevel(ctx context.Context, actor Actor, collectionID string) (Level, error) {
	state, err := loadState(ctx, s.pool, collectionID, false, false)
	if err != nil {
		return None, err
	}

	level, err := levelFor(ctx, s.pool, state, actor)
	if err != nil {
		return None, err
	}
	if level == None {
		return None, ErrNotFound
	}
	return level, nil
}

func (s *Service) AccessLevels(ctx context.Context, actor Actor, items []Collection) (map[string]Level, error) {
	levels := make(map[string]Level, len(items))
	pending := make([]string, 0, len(items))

	for _, item := range items {
		if actor.Admin || item.OwnerID == actor.UserID {
			levels[item.ID] = Full
		} else {
			pending = append(pending, item.ID)
		}
	}
	if len(pending) == 0 {
		return levels, nil
	}

	rows, err := s.pool.Query(ctx, `
		SELECT collection_id::text, level
		FROM collection_permissions
		WHERE user_id = $1::uuid
		  AND collection_id::text = ANY($2::text[])
	`, actor.UserID, pending)
	if err != nil {
		return nil, fmt.Errorf("load collection access levels: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id, value string
		if err := rows.Scan(&id, &value); err != nil {
			return nil, fmt.Errorf("scan collection access level: %w", err)
		}

		level, err := ParseLevel(value)
		if err != nil {
			return nil, fmt.Errorf("parse collection access level: %w", err)
		}
		levels[id] = level
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read collection access levels: %w", err)
	}

	for _, id := range pending {
		if levels[id] == None {
			return nil, ErrNotFound
		}
	}
	return levels, nil
}
