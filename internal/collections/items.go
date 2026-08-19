package collections

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

type Item struct {
	FileID      string
	OwnerUserID string
	Name        string
	SizeBytes   int64
	SHA256      []byte
	MIMEType    string
	Category    string
	AddedBy     string
	AddedAt     time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (s *Service) AddItem(ctx context.Context, actor Actor, collectionID, fileID string) (bool, error) {
	created := false

	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		state, err := loadState(ctx, tx, collectionID, false, true)
		if err != nil {
			return err
		}
		if err := requireLevel(ctx, tx, state, actor, Edit); err != nil {
			return err
		}

		level, err := s.nodeACL.ResolveTx(ctx, tx, fileID, actor.UserID, actor.Admin)
		if errors.Is(err, acl.ErrNotFound) || level == acl.None {
			return ErrFileNotFound
		}
		if err != nil {
			return err
		}

		var file bool
		err = tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM files f
				JOIN nodes n ON n.id = f.node_id
				WHERE f.node_id = $1::uuid
				  AND n.kind = 'file'
				  AND n.deleted_at IS NULL
			)
		`, fileID).Scan(&file)
		if err != nil {
			return fmt.Errorf("check collection file: %w", err)
		}
		if !file {
			return ErrFileNotFound
		}

		tag, err := tx.Exec(ctx, `
			INSERT INTO collection_items (collection_id, file_id, added_by)
			VALUES ($1::uuid, $2::uuid, $3::uuid)
			ON CONFLICT DO NOTHING
		`, collectionID, fileID, actor.UserID)
		if err != nil {
			return fmt.Errorf("add collection item: %w", err)
		}
		created = tag.RowsAffected() == 1
		if !created {
			return nil
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID: actor.UserID, Action: "collection.item_add",
			ResourceType: "collection", ResourceID: collectionID,
			Metadata: map[string]any{"fileId": fileID},
		})
	})
	return created, err
}

func (s *Service) RemoveItem(ctx context.Context, actor Actor, collectionID, fileID string) error {
	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		state, err := loadState(ctx, tx, collectionID, false, true)
		if err != nil {
			return err
		}
		if err := requireLevel(ctx, tx, state, actor, Edit); err != nil {
			return err
		}

		tag, err := tx.Exec(ctx, `
			DELETE FROM collection_items
			WHERE collection_id = $1::uuid
			  AND file_id = $2::uuid
		`, collectionID, fileID)
		if isInvalidUUID(err) {
			return ErrItemNotFound
		}
		if err != nil {
			return fmt.Errorf("remove collection item: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrItemNotFound
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID: actor.UserID, Action: "collection.item_remove",
			ResourceType: "collection", ResourceID: collectionID,
			Metadata: map[string]any{"fileId": fileID},
		})
	})
}

func (s *Service) ListItems(ctx context.Context, actor Actor, collectionID string) ([]Item, error) {
	state, err := loadState(ctx, s.pool, collectionID, false, false)
	if err != nil {
		return nil, err
	}
	if err := requireLevel(ctx, s.pool, state, actor, View); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		WITH RECURSIVE ancestry AS (
			SELECT ci.file_id, n.id, n.parent_id, n.deleted_at
			FROM collection_items ci
			JOIN nodes n ON n.id = ci.file_id
			WHERE ci.collection_id = $1::uuid

			UNION ALL

			SELECT ancestry.file_id, parent.id, parent.parent_id, parent.deleted_at
			FROM ancestry
			JOIN nodes parent ON ancestry.parent_id = parent.id
		),
		active_files AS (
			SELECT file_id
			FROM ancestry
			GROUP BY file_id
			HAVING BOOL_AND(deleted_at IS NULL)
		)
		SELECT
			n.id::text,
			n.owner_user_id::text,
			n.name,
			f.size_bytes,
			f.sha256,
			f.mime_type,
			f.category,
			ci.added_by::text,
			ci.added_at,
			n.created_at,
			n.updated_at
		FROM collection_items ci
		JOIN active_files active ON active.file_id = ci.file_id
		JOIN nodes n ON n.id = ci.file_id
		JOIN files f ON f.node_id = n.id
		WHERE ci.collection_id = $1::uuid
		ORDER BY ci.added_at, ci.file_id
	`, collectionID)
	if err != nil {
		return nil, fmt.Errorf("list collection items: %w", err)
	}
	defer rows.Close()

	items := make([]Item, 0)
	for rows.Next() {
		var item Item
		if err := rows.Scan(
			&item.FileID, &item.OwnerUserID, &item.Name, &item.SizeBytes,
			&item.SHA256, &item.MIMEType, &item.Category, &item.AddedBy,
			&item.AddedAt, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan collection item: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read collection items: %w", err)
	}
	return items, nil
}

func (s *Service) CanViewItem(ctx context.Context, actor Actor, collectionID, fileID string) error {
	state, err := loadState(ctx, s.pool, collectionID, false, false)
	if err != nil {
		return err
	}
	if err := requireLevel(ctx, s.pool, state, actor, View); err != nil {
		return err
	}

	var active bool
	err = s.pool.QueryRow(ctx, `
		WITH RECURSIVE chain AS (
			SELECT id, parent_id, deleted_at
			FROM nodes
			WHERE id = $2::uuid

			UNION ALL

			SELECT parent.id, parent.parent_id, parent.deleted_at
			FROM nodes parent
			JOIN chain child ON child.parent_id = parent.id
		)
		SELECT
			EXISTS (
				SELECT 1
				FROM collection_items
				WHERE collection_id = $1::uuid
				  AND file_id = $2::uuid
			)
			AND EXISTS (
				SELECT 1
				FROM files
				WHERE node_id = $2::uuid
			)
			AND NOT EXISTS (
				SELECT 1
				FROM chain
				WHERE deleted_at IS NOT NULL
			)
	`, collectionID, fileID).Scan(&active)
	if err != nil {
		if isInvalidUUID(err) {
			return ErrFileNotFound
		}
		return fmt.Errorf("resolve collection item: %w", err)
	}
	if !active {
		return ErrFileNotFound
	}
	return nil
}
