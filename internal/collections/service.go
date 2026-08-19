package collections

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/nodes"
	"github.com/mewisme/discloud/internal/postgres"
)

var (
	ErrNotFound      = errors.New("collection not found")
	ErrForbidden     = errors.New("collection permission denied")
	ErrInvalidLevel  = errors.New("invalid collection permission level")
	ErrNameConflict  = errors.New("collection name already exists")
	ErrNotDeleted    = errors.New("collection is not deleted")
	ErrOwnerGrant    = errors.New("collection owner already has full access")
	ErrGrantNotFound = errors.New("collection grant not found")
	ErrUserNotFound  = errors.New("user not found")
	ErrItemNotFound  = errors.New("collection item not found")
	ErrFileNotFound  = errors.New("file not found")
	ErrInvalidCursor = errors.New("invalid collection cursor")
)

type Level uint8

const (
	None Level = iota
	View
	Edit
	Full
)

type Actor struct {
	UserID string
	Admin  bool
}

type Collection struct {
	ID          string
	OwnerID     string
	Name        string
	NameKey     string
	Description string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type UpdateInput struct {
	Name        *string
	Description *string
}

type collectionState struct {
	Collection
	DeletedAt *time.Time
}

type Service struct {
	pool    *pgxpool.Pool
	nodeACL *acl.Service
}

type scanner interface {
	Scan(...any) error
}

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

const collectionColumns = `
	id::text,
	owner_user_id::text,
	name,
	name_key,
	COALESCE(description, ''),
	created_at,
	updated_at
`

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, nodeACL: acl.New(pool)}
}

func ParseLevel(value string) (Level, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "view":
		return View, nil
	case "edit":
		return Edit, nil
	case "full":
		return Full, nil
	default:
		return None, ErrInvalidLevel
	}
}

func (l Level) String() string {
	switch l {
	case View:
		return "view"
	case Edit:
		return "edit"
	case Full:
		return "full"
	default:
		return ""
	}
}

func (l Level) Allows(required Level) bool {
	return l >= required
}

func (s *Service) Create(ctx context.Context, actor Actor, name, description string) (Collection, error) {
	name, nameKey, err := nodes.NormalizeName(name)
	if err != nil {
		return Collection{}, err
	}

	var collection Collection
	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		err := scanCollection(tx.QueryRow(ctx, `
			INSERT INTO collections (owner_user_id, name, name_key, description, created_by)
			VALUES ($1::uuid, $2, $3, NULLIF($4, ''), $1::uuid)
			RETURNING `+collectionColumns,
			actor.UserID, name, nameKey, strings.TrimSpace(description),
		), &collection)
		if err != nil {
			if isUniqueViolation(err) {
				return ErrNameConflict
			}
			return fmt.Errorf("create collection: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID: actor.UserID, Action: "collection.create",
			ResourceType: "collection", ResourceID: collection.ID,
		})
	})
	if err != nil {
		return Collection{}, err
	}
	return collection, nil
}

func (s *Service) Get(ctx context.Context, actor Actor, collectionID string) (Collection, error) {
	state, err := loadState(ctx, s.pool, collectionID, false, false)
	if err != nil {
		return Collection{}, err
	}

	level, err := levelFor(ctx, s.pool, state, actor)
	if err != nil {
		return Collection{}, err
	}
	if !level.Allows(View) {
		return Collection{}, ErrNotFound
	}
	return state.Collection, nil
}

func (s *Service) List(ctx context.Context, actor Actor, limit int, afterNameKey, afterID string) ([]Collection, bool, error) {
	if limit < 1 || limit > 100 || (afterID == "") != (afterNameKey == "") {
		return nil, false, ErrInvalidCursor
	}

	rows, err := s.pool.Query(ctx, `
		SELECT `+collectionColumns+`
		FROM collections c
		WHERE c.deleted_at IS NULL
		  AND (
				$1::boolean
				OR c.owner_user_id = $2::uuid
				OR EXISTS (
					SELECT 1
					FROM collection_permissions cp
					WHERE cp.collection_id = c.id
					  AND cp.user_id = $2::uuid
				)
		  )
		  AND (
				$3 = ''
				OR (c.name_key, c.id) > ($3, $4::uuid)
		  )
		ORDER BY c.name_key, c.id
		LIMIT $5
	`, actor.Admin, actor.UserID, afterNameKey, nullableString(afterID), limit+1)
	if err != nil {
		if isInvalidUUID(err) {
			return nil, false, ErrInvalidCursor
		}
		return nil, false, fmt.Errorf("list collections: %w", err)
	}
	defer rows.Close()

	result := make([]Collection, 0, limit+1)
	for rows.Next() {
		var collection Collection
		if err := scanCollection(rows, &collection); err != nil {
			return nil, false, fmt.Errorf("scan collection: %w", err)
		}
		result = append(result, collection)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("read collections: %w", err)
	}

	hasMore := len(result) > limit
	if hasMore {
		result = result[:limit]
	}
	return result, hasMore, nil
}

func (s *Service) Update(ctx context.Context, actor Actor, collectionID string, input UpdateInput) (Collection, error) {
	if input.Name == nil && input.Description == nil {
		return Collection{}, errors.New("collection update is empty")
	}

	var name, nameKey any
	if input.Name != nil {
		display, key, err := nodes.NormalizeName(*input.Name)
		if err != nil {
			return Collection{}, err
		}
		name, nameKey = display, key
	}

	description := ""
	if input.Description != nil {
		description = strings.TrimSpace(*input.Description)
	}

	var collection Collection
	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		state, err := loadState(ctx, tx, collectionID, false, true)
		if err != nil {
			return err
		}
		if err := requireLevel(ctx, tx, state, actor, Edit); err != nil {
			return err
		}

		err = scanCollection(tx.QueryRow(ctx, `
			UPDATE collections
			SET name = COALESCE($2, name),
			    name_key = COALESCE($3, name_key),
			    description = CASE WHEN $4 THEN NULLIF($5, '') ELSE description END,
			    updated_at = now()
			WHERE id = $1::uuid
			RETURNING `+collectionColumns,
			collectionID, name, nameKey, input.Description != nil, description,
		), &collection)
		if err != nil {
			if isUniqueViolation(err) {
				return ErrNameConflict
			}
			return fmt.Errorf("update collection: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID: actor.UserID, Action: "collection.update",
			ResourceType: "collection", ResourceID: collection.ID,
		})
	})
	if err != nil {
		return Collection{}, err
	}
	return collection, nil
}

func (s *Service) Trash(ctx context.Context, actor Actor, collectionID string) error {
	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		state, err := loadState(ctx, tx, collectionID, false, true)
		if err != nil {
			return err
		}
		if err := requireLevel(ctx, tx, state, actor, Edit); err != nil {
			return err
		}

		tag, err := tx.Exec(ctx, `
			UPDATE collections
			SET deleted_at = now(), deleted_by = $2::uuid, updated_at = now()
			WHERE id = $1::uuid AND deleted_at IS NULL
		`, collectionID, actor.UserID)
		if err != nil {
			return fmt.Errorf("trash collection: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrNotFound
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID: actor.UserID, Action: "collection.trash",
			ResourceType: "collection", ResourceID: collectionID,
		})
	})
}

func (s *Service) Restore(ctx context.Context, actor Actor, collectionID, newName string) (Collection, error) {
	var collection Collection

	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		state, err := loadState(ctx, tx, collectionID, true, true)
		if err != nil {
			return err
		}
		if state.DeletedAt == nil {
			return ErrNotDeleted
		}
		if err := requireLevel(ctx, tx, state, actor, Edit); err != nil {
			return err
		}

		name, nameKey := state.Name, state.NameKey
		if newName != "" {
			name, nameKey, err = nodes.NormalizeName(newName)
			if err != nil {
				return err
			}
		}

		err = scanCollection(tx.QueryRow(ctx, `
			UPDATE collections
			SET name = $2,
			    name_key = $3,
			    deleted_at = NULL,
			    deleted_by = NULL,
			    updated_at = now()
			WHERE id = $1::uuid AND deleted_at IS NOT NULL
			RETURNING `+collectionColumns,
			collectionID, name, nameKey,
		), &collection)
		if err != nil {
			if isUniqueViolation(err) {
				return ErrNameConflict
			}
			return fmt.Errorf("restore collection: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID: actor.UserID, Action: "collection.restore",
			ResourceType: "collection", ResourceID: collection.ID,
		})
	})
	if err != nil {
		return Collection{}, err
	}
	return collection, nil
}

func loadState(ctx context.Context, db queryRower, collectionID string, includeDeleted, lock bool) (collectionState, error) {
	query := `SELECT ` + collectionColumns + `, deleted_at FROM collections WHERE id = $1::uuid`
	if !includeDeleted {
		query += ` AND deleted_at IS NULL`
	}
	if lock {
		query += ` FOR UPDATE`
	}

	var state collectionState
	err := db.QueryRow(ctx, query, collectionID).Scan(
		&state.ID, &state.OwnerID, &state.Name, &state.NameKey, &state.Description,
		&state.CreatedAt, &state.UpdatedAt, &state.DeletedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return collectionState{}, ErrNotFound
	}
	if err != nil {
		return collectionState{}, fmt.Errorf("load collection: %w", err)
	}
	return state, nil
}

func levelFor(ctx context.Context, db queryRower, state collectionState, actor Actor) (Level, error) {
	if actor.Admin || state.OwnerID == actor.UserID {
		return Full, nil
	}

	var value string
	err := db.QueryRow(ctx, `
		SELECT level
		FROM collection_permissions
		WHERE collection_id = $1::uuid
		  AND user_id = $2::uuid
	`, state.ID, actor.UserID).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return None, nil
	}
	if err != nil {
		return None, fmt.Errorf("resolve collection permission: %w", err)
	}
	return ParseLevel(value)
}

func requireLevel(ctx context.Context, db queryRower, state collectionState, actor Actor, required Level) error {
	level, err := levelFor(ctx, db, state, actor)
	if err != nil {
		return err
	}
	if level == None {
		return ErrNotFound
	}
	if !level.Allows(required) {
		return ErrForbidden
	}
	return nil
}

func scanCollection(row scanner, collection *Collection) error {
	return row.Scan(
		&collection.ID, &collection.OwnerID, &collection.Name, &collection.NameKey,
		&collection.Description, &collection.CreatedAt, &collection.UpdatedAt,
	)
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func isInvalidUUID(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "22P02"
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
