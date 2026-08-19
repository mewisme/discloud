package nodes

import (
	"context"
	"errors"
	"fmt"
	"time"
)

var ErrInvalidTrashQuery = errors.New("invalid trash query")

type TrashItem struct {
	Node
	DeletedAt time.Time
	DeletedBy string
	SizeBytes *int64
}

func (s *Service) ListTrash(ctx context.Context, actor Actor, ownerID string, limit int, beforeDeletedAt *time.Time, beforeID string) ([]TrashItem, bool, error) {
	if limit < 1 || limit > 100 || (beforeDeletedAt == nil) != (beforeID == "") {
		return nil, false, ErrInvalidTrashQuery
	}

	var owner any
	if actor.Admin {
		if ownerID != "" {
			owner = ownerID
		}
	} else {
		if ownerID != "" && ownerID != actor.UserID {
			return nil, false, ErrForbidden
		}
		owner = actor.UserID
	}

	var beforeAt, cursorID any
	if beforeDeletedAt != nil {
		beforeAt = *beforeDeletedAt
		cursorID = beforeID
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			n.id::text,
			n.kind,
			n.owner_user_id::text,
			COALESCE(n.parent_id::text, ''),
			n.name,
			n.name_key,
			n.is_root,
			n.is_favorite,
			n.created_at,
			n.updated_at,
			n.deleted_at,
			COALESCE(n.deleted_by::text, ''),
			f.size_bytes
		FROM nodes n
		LEFT JOIN files f ON f.node_id = n.id
		WHERE n.deleted_at IS NOT NULL
		  AND ($1::uuid IS NULL OR n.owner_user_id = $1::uuid)
		  AND (
				$2::timestamptz IS NULL
				OR (n.deleted_at, n.id) < ($2::timestamptz, $3::uuid)
		  )
		  AND NOT EXISTS (
				WITH RECURSIVE ancestors AS (
					SELECT parent.id, parent.parent_id, parent.deleted_at
					FROM nodes parent
					WHERE parent.id = n.parent_id

					UNION ALL

					SELECT parent.id, parent.parent_id, parent.deleted_at
					FROM nodes parent
					JOIN ancestors child ON child.parent_id = parent.id
				)
				SELECT 1
				FROM ancestors
				WHERE deleted_at IS NOT NULL
		  )
		ORDER BY n.deleted_at DESC, n.id DESC
		LIMIT $4
	`, owner, beforeAt, cursorID, limit+1)
	if err != nil {
		if isInvalidUUID(err) {
			return nil, false, ErrInvalidTrashQuery
		}
		return nil, false, fmt.Errorf("list trash: %w", err)
	}
	defer rows.Close()

	items := make([]TrashItem, 0, limit+1)
	for rows.Next() {
		var item TrashItem
		if err := rows.Scan(
			&item.ID,
			&item.Kind,
			&item.OwnerID,
			&item.ParentID,
			&item.Name,
			&item.NameKey,
			&item.IsRoot,
			&item.IsFavorite,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.DeletedAt,
			&item.DeletedBy,
			&item.SizeBytes,
		); err != nil {
			return nil, false, fmt.Errorf("scan trash item: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("read trash: %w", err)
	}

	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return items, hasMore, nil
}
