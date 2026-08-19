package shares

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type PublicNode struct {
	ID        string
	Kind      string
	Name      string
	SizeBytes *int64
	MIMEType  string
	Category  string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type PublicFolder struct {
	ID       string
	Name     string
	Children []PublicNode
}

type PublicCollection struct {
	ID          string
	Name        string
	Description string
	Items       []PublicNode
}

func (s *Service) Folder(ctx context.Context, share Share, folderID string) (PublicFolder, error) {
	if share.ResourceType != ResourceFolder {
		return PublicFolder{}, ErrNotFound
	}
	if folderID == "" {
		folderID = share.ResourceID
	}

	var folder PublicFolder
	err := s.pool.QueryRow(ctx, `
		WITH RECURSIVE tree AS (
			SELECT id, parent_id, kind, name
			FROM nodes
			WHERE id = $1::uuid
			  AND kind = 'folder'
			  AND deleted_at IS NULL

			UNION ALL

			SELECT child.id, child.parent_id, child.kind, child.name
			FROM nodes child
			JOIN tree parent ON child.parent_id = parent.id
			WHERE child.deleted_at IS NULL
		)
		SELECT id::text, name
		FROM tree
		WHERE id = $2::uuid
		  AND kind = 'folder'
	`, share.ResourceID, folderID).Scan(&folder.ID, &folder.Name)
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return PublicFolder{}, ErrNotFound
	}
	if err != nil {
		return PublicFolder{}, fmt.Errorf("resolve public folder: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			n.id::text,
			n.kind,
			n.name,
			f.size_bytes,
			COALESCE(f.mime_type, ''),
			COALESCE(f.category, ''),
			n.created_at,
			n.updated_at
		FROM nodes n
		LEFT JOIN files f ON f.node_id = n.id
		WHERE n.parent_id = $1::uuid
		  AND n.deleted_at IS NULL
		ORDER BY n.kind DESC, n.name_key, n.id
	`, folder.ID)
	if err != nil {
		return PublicFolder{}, fmt.Errorf("list public folder: %w", err)
	}
	defer rows.Close()

	folder.Children = make([]PublicNode, 0)
	for rows.Next() {
		var child PublicNode
		if err := rows.Scan(
			&child.ID,
			&child.Kind,
			&child.Name,
			&child.SizeBytes,
			&child.MIMEType,
			&child.Category,
			&child.CreatedAt,
			&child.UpdatedAt,
		); err != nil {
			return PublicFolder{}, fmt.Errorf("scan public folder child: %w", err)
		}
		folder.Children = append(folder.Children, child)
	}
	if err := rows.Err(); err != nil {
		return PublicFolder{}, fmt.Errorf("read public folder: %w", err)
	}

	return folder, nil
}

func (s *Service) Collection(ctx context.Context, share Share) (PublicCollection, error) {
	if share.ResourceType != ResourceCollection {
		return PublicCollection{}, ErrNotFound
	}

	var collection PublicCollection
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, name, COALESCE(description, '')
		FROM collections
		WHERE id = $1::uuid
		  AND deleted_at IS NULL
	`, share.ResourceID).Scan(
		&collection.ID,
		&collection.Name,
		&collection.Description,
	)
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return PublicCollection{}, ErrNotFound
	}
	if err != nil {
		return PublicCollection{}, fmt.Errorf("resolve public collection: %w", err)
	}

	items, err := s.CollectionItems(ctx, share)
	if err != nil {
		return PublicCollection{}, err
	}
	collection.Items = items
	return collection, nil
}

func (s *Service) CollectionItems(ctx context.Context, share Share) ([]PublicNode, error) {
	if share.ResourceType != ResourceCollection {
		return nil, ErrNotFound
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
			   AND BOOL_OR(parent_id IS NULL)
		)
		SELECT
			n.id::text,
			n.kind,
			n.name,
			f.size_bytes,
			f.mime_type,
			f.category,
			n.created_at,
			n.updated_at
		FROM collection_items ci
		JOIN active_files active ON active.file_id = ci.file_id
		JOIN nodes n ON n.id = ci.file_id
		JOIN files f ON f.node_id = n.id
		WHERE ci.collection_id = $1::uuid
		ORDER BY ci.added_at, ci.file_id
	`, share.ResourceID)
	if err != nil {
		return nil, fmt.Errorf("list public collection items: %w", err)
	}
	defer rows.Close()

	items := make([]PublicNode, 0)
	for rows.Next() {
		var item PublicNode
		if err := rows.Scan(
			&item.ID,
			&item.Kind,
			&item.Name,
			&item.SizeBytes,
			&item.MIMEType,
			&item.Category,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan public collection item: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read public collection items: %w", err)
	}

	return items, nil
}

func (s *Service) CanAccessFolder(ctx context.Context, share Share, folderID string) error {
	if share.ResourceType != ResourceFolder {
		return ErrNotFound
	}

	var allowed bool
	err := s.pool.QueryRow(ctx, `
		WITH RECURSIVE tree AS (
			SELECT id, parent_id, kind
			FROM nodes
			WHERE id = $1::uuid
			  AND kind = 'folder'
			  AND deleted_at IS NULL

			UNION ALL

			SELECT child.id, child.parent_id, child.kind
			FROM nodes child
			JOIN tree parent ON child.parent_id = parent.id
			WHERE child.deleted_at IS NULL
		)
		SELECT EXISTS (
			SELECT 1
			FROM tree
			WHERE id = $2::uuid
			  AND kind = 'folder'
		)
	`, share.ResourceID, folderID).Scan(&allowed)
	if isInvalidUUID(err) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("authorize public folder: %w", err)
	}
	if !allowed {
		return ErrNotFound
	}
	return nil
}

func (s *Service) CanAccessFile(ctx context.Context, share Share, fileID string) error {
	switch share.ResourceType {
	case ResourceFile:
		if share.ResourceID != fileID {
			return ErrNotFound
		}
		return nil

	case ResourceFolder:
		var allowed bool
		err := s.pool.QueryRow(ctx, `
			WITH RECURSIVE tree AS (
				SELECT id, parent_id, kind
				FROM nodes
				WHERE id = $1::uuid
				  AND kind = 'folder'
				  AND deleted_at IS NULL

				UNION ALL

				SELECT child.id, child.parent_id, child.kind
				FROM nodes child
				JOIN tree parent ON child.parent_id = parent.id
				WHERE child.deleted_at IS NULL
			)
			SELECT EXISTS (
				SELECT 1
				FROM tree
				JOIN files ON files.node_id = tree.id
				WHERE tree.id = $2::uuid
				  AND tree.kind = 'file'
			)
		`, share.ResourceID, fileID).Scan(&allowed)
		if isInvalidUUID(err) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("authorize public folder file: %w", err)
		}
		if !allowed {
			return ErrNotFound
		}
		return nil

	case ResourceCollection:
		var allowed bool
		err := s.pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM collection_items ci
				JOIN files f ON f.node_id = ci.file_id
				WHERE ci.collection_id = $1::uuid
				  AND ci.file_id = $2::uuid
			)
		`, share.ResourceID, fileID).Scan(&allowed)
		if isInvalidUUID(err) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("authorize public collection file: %w", err)
		}
		if !allowed {
			return ErrNotFound
		}
		return nil

	default:
		return ErrNotFound
	}
}
