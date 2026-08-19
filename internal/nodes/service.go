package nodes

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/postgres"
)

var (
	ErrNotFound      = errors.New("node not found")
	ErrNotFolder     = errors.New("node is not a folder")
	ErrNameConflict  = errors.New("node name already exists")
	ErrRootImmutable = errors.New("root node is immutable")
	ErrCycle         = errors.New("folder cycle")
	ErrCrossOwner    = errors.New("cross-owner move is not supported")
	ErrInvalidCursor = errors.New("invalid node cursor")
)

type Actor struct {
	UserID string
	Admin  bool
}

type Node struct {
	ID         string
	Kind       string
	OwnerID    string
	ParentID   string
	Name       string
	NameKey    string
	IsRoot     bool
	IsFavorite bool
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type Service struct {
	pool *pgxpool.Pool
}

type scanner interface {
	Scan(...any) error
}

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

const nodeColumns = `
	id::text,
	kind,
	owner_user_id::text,
	COALESCE(parent_id::text, ''),
	name,
	name_key,
	is_root,
	is_favorite,
	created_at,
	updated_at
`

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Get(ctx context.Context, actor Actor, nodeID string) (Node, error) {
	node, err := loadNode(ctx, s.pool, nodeID, false)
	if err != nil {
		return Node{}, err
	}
	if !canManage(actor, node.OwnerID) {
		return Node{}, ErrNotFound
	}
	return node, nil
}

func (s *Service) CreateFolder(ctx context.Context, actor Actor, parentID, name string) (Node, error) {
	display, key, err := NormalizeName(name)
	if err != nil {
		return Node{}, err
	}

	var node Node
	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		parent, err := loadNode(ctx, tx, parentID, true)
		if err != nil {
			return err
		}
		if parent.Kind != "folder" {
			return ErrNotFolder
		}
		if !canManage(actor, parent.OwnerID) {
			return ErrNotFound
		}

		err = tx.QueryRow(ctx, `
			INSERT INTO nodes (
				kind,
				owner_user_id,
				parent_id,
				name,
				name_key,
				created_by
			)
			VALUES ('folder', $1, $2::uuid, $3, $4, $5)
			RETURNING `+nodeColumns,
			parent.OwnerID,
			parent.ID,
			display,
			key,
			actor.UserID,
		).Scan(
			&node.ID,
			&node.Kind,
			&node.OwnerID,
			&node.ParentID,
			&node.Name,
			&node.NameKey,
			&node.IsRoot,
			&node.IsFavorite,
			&node.CreatedAt,
			&node.UpdatedAt,
		)
		if err != nil {
			return fmt.Errorf("create folder: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actor.UserID,
			Action:       "folder.create",
			ResourceType: "node",
			ResourceID:   node.ID,
		})
	})
	if err != nil {
		if isUniqueViolation(err) {
			return Node{}, ErrNameConflict
		}
		return Node{}, err
	}

	return node, nil
}

func (s *Service) ListChildren(
	ctx context.Context,
	actor Actor,
	parentID string,
	limit int,
	afterNameKey string,
	afterID string,
) ([]Node, bool, error) {
	parent, err := loadNode(ctx, s.pool, parentID, false)
	if err != nil {
		return nil, false, err
	}
	if parent.Kind != "folder" {
		return nil, false, ErrNotFolder
	}
	if !canManage(actor, parent.OwnerID) {
		return nil, false, ErrNotFound
	}

	args := []any{parent.ID, limit + 1}
	query := `
		SELECT ` + nodeColumns + `
		FROM nodes
		WHERE parent_id = $1::uuid
		  AND deleted_at IS NULL
	`

	if afterID != "" {
		query += `
		  AND (name_key, id) > ($3, $4::uuid)
		`
		args = append(args, afterNameKey, afterID)
	}

	query += `
		ORDER BY name_key, id
		LIMIT $2
	`

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		if isInvalidUUID(err) {
			return nil, false, ErrInvalidCursor
		}
		return nil, false, fmt.Errorf("list children: %w", err)
	}
	defer rows.Close()

	nodes := make([]Node, 0, limit+1)
	for rows.Next() {
		node, err := scanNode(rows)
		if err != nil {
			return nil, false, fmt.Errorf("scan child: %w", err)
		}
		nodes = append(nodes, node)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("read children: %w", err)
	}

	hasMore := len(nodes) > limit
	if hasMore {
		nodes = nodes[:limit]
	}

	return nodes, hasMore, nil
}

func (s *Service) Breadcrumbs(ctx context.Context, actor Actor, nodeID string) ([]Node, error) {
	rows, err := s.pool.Query(ctx, `
		WITH RECURSIVE ancestors AS (
			SELECT
				id,
				kind,
				owner_user_id,
				parent_id,
				name,
				name_key,
				is_root,
				is_favorite,
				created_at,
				updated_at,
				0 AS depth
			FROM nodes
			WHERE id = $1::uuid
			  AND deleted_at IS NULL

			UNION ALL

			SELECT
				parent.id,
				parent.kind,
				parent.owner_user_id,
				parent.parent_id,
				parent.name,
				parent.name_key,
				parent.is_root,
				parent.is_favorite,
				parent.created_at,
				parent.updated_at,
				child.depth + 1
			FROM nodes parent
			JOIN ancestors child ON child.parent_id = parent.id
			WHERE parent.deleted_at IS NULL
		)
		SELECT
			id::text,
			kind,
			owner_user_id::text,
			COALESCE(parent_id::text, ''),
			name,
			name_key,
			is_root,
			is_favorite,
			created_at,
			updated_at
		FROM ancestors
		ORDER BY depth DESC
	`, nodeID)
	if err != nil {
		if isInvalidUUID(err) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query breadcrumbs: %w", err)
	}
	defer rows.Close()

	result := make([]Node, 0)
	for rows.Next() {
		node, err := scanNode(rows)
		if err != nil {
			return nil, fmt.Errorf("scan breadcrumb: %w", err)
		}
		result = append(result, node)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read breadcrumbs: %w", err)
	}
	if len(result) == 0 {
		return nil, ErrNotFound
	}
	if !canManage(actor, result[0].OwnerID) {
		return nil, ErrNotFound
	}

	return result, nil
}

func (s *Service) Rename(ctx context.Context, actor Actor, nodeID, name string) (Node, error) {
	display, key, err := NormalizeName(name)
	if err != nil {
		return Node{}, err
	}

	var node Node
	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		current, err := loadNode(ctx, tx, nodeID, true)
		if err != nil {
			return err
		}
		if !canManage(actor, current.OwnerID) {
			return ErrNotFound
		}
		if current.IsRoot {
			return ErrRootImmutable
		}

		err = tx.QueryRow(ctx, `
			UPDATE nodes
			SET name = $2,
			    name_key = $3,
			    updated_at = now()
			WHERE id = $1::uuid
			RETURNING `+nodeColumns,
			current.ID,
			display,
			key,
		).Scan(
			&node.ID,
			&node.Kind,
			&node.OwnerID,
			&node.ParentID,
			&node.Name,
			&node.NameKey,
			&node.IsRoot,
			&node.IsFavorite,
			&node.CreatedAt,
			&node.UpdatedAt,
		)
		if err != nil {
			return fmt.Errorf("rename node: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actor.UserID,
			Action:       "node.rename",
			ResourceType: "node",
			ResourceID:   node.ID,
		})
	})
	if err != nil {
		if isUniqueViolation(err) {
			return Node{}, ErrNameConflict
		}
		return Node{}, err
	}

	return node, nil
}

func (s *Service) Move(ctx context.Context, actor Actor, nodeID, parentID string) (Node, error) {
	preliminary, err := loadNode(ctx, s.pool, nodeID, false)
	if err != nil {
		return Node{}, err
	}
	if !canManage(actor, preliminary.OwnerID) {
		return Node{}, ErrNotFound
	}
	if preliminary.IsRoot {
		return Node{}, ErrRootImmutable
	}

	var node Node
	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
		`, preliminary.OwnerID); err != nil {
			return fmt.Errorf("lock owner tree: %w", err)
		}

		current, err := loadNode(ctx, tx, nodeID, true)
		if err != nil {
			return err
		}
		if current.OwnerID != preliminary.OwnerID || !canManage(actor, current.OwnerID) {
			return ErrNotFound
		}
		if current.IsRoot {
			return ErrRootImmutable
		}

		parent, err := loadNode(ctx, tx, parentID, true)
		if err != nil {
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

		if current.ParentID == parent.ID {
			node = current
			return nil
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

		err = tx.QueryRow(ctx, `
			UPDATE nodes
			SET parent_id = $2::uuid,
			    updated_at = now()
			WHERE id = $1::uuid
			RETURNING `+nodeColumns,
			current.ID,
			parent.ID,
		).Scan(
			&node.ID,
			&node.Kind,
			&node.OwnerID,
			&node.ParentID,
			&node.Name,
			&node.NameKey,
			&node.IsRoot,
			&node.IsFavorite,
			&node.CreatedAt,
			&node.UpdatedAt,
		)
		if err != nil {
			return fmt.Errorf("move node: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actor.UserID,
			Action:       "node.move",
			ResourceType: "node",
			ResourceID:   node.ID,
		})
	})
	if err != nil {
		if isUniqueViolation(err) {
			return Node{}, ErrNameConflict
		}
		return Node{}, err
	}

	return node, nil
}

func loadNode(ctx context.Context, db queryRower, nodeID string, lock bool) (Node, error) {
	query := `
		SELECT ` + nodeColumns + `
		FROM nodes
		WHERE id = $1::uuid
		  AND deleted_at IS NULL
	`
	if lock {
		query += " FOR UPDATE"
	}

	node, err := scanNode(db.QueryRow(ctx, query, nodeID))
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return Node{}, ErrNotFound
	}
	if err != nil {
		return Node{}, fmt.Errorf("load node: %w", err)
	}

	return node, nil
}

func scanNode(row scanner) (Node, error) {
	var node Node
	err := row.Scan(
		&node.ID,
		&node.Kind,
		&node.OwnerID,
		&node.ParentID,
		&node.Name,
		&node.NameKey,
		&node.IsRoot,
		&node.IsFavorite,
		&node.CreatedAt,
		&node.UpdatedAt,
	)
	return node, err
}

func folderContains(ctx context.Context, tx pgx.Tx, startID, targetID string) (bool, error) {
	var contains bool
	err := tx.QueryRow(ctx, `
		WITH RECURSIVE ancestors AS (
			SELECT id, parent_id
			FROM nodes
			WHERE id = $1::uuid

			UNION ALL

			SELECT parent.id, parent.parent_id
			FROM nodes parent
			JOIN ancestors child ON child.parent_id = parent.id
		)
		SELECT EXISTS (
			SELECT 1
			FROM ancestors
			WHERE id = $2::uuid
		)
	`, startID, targetID).Scan(&contains)
	if err != nil {
		return false, fmt.Errorf("check folder cycle: %w", err)
	}

	return contains, nil
}

func canManage(actor Actor, ownerID string) bool {
	return actor.Admin || actor.UserID == ownerID
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func isInvalidUUID(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "22P02"
}
