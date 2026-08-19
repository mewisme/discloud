package acl

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/postgres"
)

var (
	ErrNotFound      = errors.New("folder not found")
	ErrNotFolder     = errors.New("node is not a folder")
	ErrForbidden     = errors.New("permission denied")
	ErrInvalidLevel  = errors.New("invalid permission level")
	ErrUserNotFound  = errors.New("user not found")
	ErrOwnerGrant    = errors.New("folder owner already has full access")
	ErrGrantNotFound = errors.New("folder grant not found")
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

type Grant struct {
	UserID    string
	Username  string
	Level     Level
	CreatedBy string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Service struct {
	pool *pgxpool.Pool
}

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
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

func (s *Service) Resolve(ctx context.Context, nodeID, userID string, admin bool) (Level, error) {
	return resolve(ctx, s.pool, nodeID, userID, admin)
}

func (s *Service) ResolveTx(ctx context.Context, tx pgx.Tx, nodeID, userID string, admin bool) (Level, error) {
	return resolve(ctx, tx, nodeID, userID, admin)
}

func (s *Service) List(ctx context.Context, actor Actor, folderID string) ([]Grant, error) {
	level, err := s.Resolve(ctx, folderID, actor.UserID, actor.Admin)
	if err != nil {
		return nil, err
	}
	if level == None {
		return nil, ErrNotFound
	}
	if !level.Allows(Full) {
		return nil, ErrForbidden
	}

	if err := requireFolder(ctx, s.pool, folderID); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			fp.user_id::text,
			u.username::text,
			fp.level,
			fp.created_by::text,
			fp.created_at,
			fp.updated_at
		FROM folder_permissions fp
		JOIN users u ON u.id = fp.user_id
		WHERE fp.folder_id = $1::uuid
		ORDER BY u.username, fp.user_id
	`, folderID)
	if err != nil {
		return nil, fmt.Errorf("list folder grants: %w", err)
	}
	defer rows.Close()

	grants := make([]Grant, 0)
	for rows.Next() {
		var grant Grant
		var level string

		if err := rows.Scan(
			&grant.UserID,
			&grant.Username,
			&level,
			&grant.CreatedBy,
			&grant.CreatedAt,
			&grant.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan folder grant: %w", err)
		}

		grant.Level, err = ParseLevel(level)
		if err != nil {
			return nil, fmt.Errorf("invalid stored permission level: %w", err)
		}
		grants = append(grants, grant)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read folder grants: %w", err)
	}

	return grants, nil
}

func (s *Service) Set(ctx context.Context, actor Actor, folderID, userID string, level Level) (Grant, error) {
	if level < View || level > Full {
		return Grant{}, ErrInvalidLevel
	}

	var grant Grant
	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		ownerID, err := folderOwner(ctx, tx, folderID)
		if err != nil {
			return err
		}

		if err := lockOwnerTree(ctx, tx, ownerID); err != nil {
			return err
		}

		current, err := s.ResolveTx(ctx, tx, folderID, actor.UserID, actor.Admin)
		if err != nil {
			return err
		}
		if current == None {
			return ErrNotFound
		}
		if !current.Allows(Full) {
			return ErrForbidden
		}

		err = tx.QueryRow(ctx, `
			SELECT id::text, username::text
			FROM users
			WHERE id = $1::uuid
		`, userID).Scan(&grant.UserID, &grant.Username)

		if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
			return ErrUserNotFound
		}
		if err != nil {
			return fmt.Errorf("get grantee: %w", err)
		}

		if grant.UserID == ownerID {
			return ErrOwnerGrant
		}

		var storedLevel string
		err = tx.QueryRow(ctx, `
			INSERT INTO folder_permissions (
				folder_id,
				user_id,
				level,
				created_by
			)
			VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
			ON CONFLICT (folder_id, user_id) DO UPDATE
			SET level = EXCLUDED.level,
			    updated_at = now()
			RETURNING
				level,
				created_by::text,
				created_at,
				updated_at
		`, folderID, grant.UserID, level.String(), actor.UserID).Scan(
			&storedLevel,
			&grant.CreatedBy,
			&grant.CreatedAt,
			&grant.UpdatedAt,
		)
		if err != nil {
			return fmt.Errorf("set folder grant: %w", err)
		}

		grant.Level, err = ParseLevel(storedLevel)
		if err != nil {
			return err
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actor.UserID,
			Action:       "folder.permission_set",
			ResourceType: "node",
			ResourceID:   folderID,
			Metadata: map[string]any{
				"userId": grant.UserID,
				"level":  grant.Level.String(),
			},
		})
	})
	if err != nil {
		return Grant{}, err
	}

	return grant, nil
}

func (s *Service) Delete(ctx context.Context, actor Actor, folderID, userID string) error {
	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		ownerID, err := folderOwner(ctx, tx, folderID)
		if err != nil {
			return err
		}

		if err := lockOwnerTree(ctx, tx, ownerID); err != nil {
			return err
		}

		current, err := s.ResolveTx(ctx, tx, folderID, actor.UserID, actor.Admin)
		if err != nil {
			return err
		}
		if current == None {
			return ErrNotFound
		}
		if !current.Allows(Full) {
			return ErrForbidden
		}

		tag, err := tx.Exec(ctx, `
			DELETE FROM folder_permissions
			WHERE folder_id = $1::uuid
			  AND user_id = $2::uuid
		`, folderID, userID)
		if isInvalidUUID(err) {
			return ErrGrantNotFound
		}
		if err != nil {
			return fmt.Errorf("delete folder grant: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrGrantNotFound
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actor.UserID,
			Action:       "folder.permission_delete",
			ResourceType: "node",
			ResourceID:   folderID,
			Metadata: map[string]any{
				"userId": userID,
			},
		})
	})
}

func resolve(ctx context.Context, db queryRower, nodeID, userID string, admin bool) (Level, error) {
	var ownerID string
	var score int
	var reachesRoot bool

	err := db.QueryRow(ctx, `
		WITH RECURSIVE ancestors AS (
			SELECT id, parent_id
			FROM nodes
			WHERE id = $1::uuid
			  AND deleted_at IS NULL

			UNION ALL

			SELECT parent.id, parent.parent_id
			FROM nodes parent
			JOIN ancestors child ON child.parent_id = parent.id
			WHERE parent.deleted_at IS NULL
		),
		summary AS (
			SELECT
				COALESCE(MAX(
					CASE fp.level
						WHEN 'full' THEN 3
						WHEN 'edit' THEN 2
						WHEN 'view' THEN 1
						ELSE 0
					END
				), 0) AS score,
				COALESCE(BOOL_OR(ancestors.parent_id IS NULL), false) AS reaches_root
			FROM ancestors
			LEFT JOIN folder_permissions fp
			  ON fp.folder_id = ancestors.id
			 AND fp.user_id = $2::uuid
		)
		SELECT
			target.owner_user_id::text,
			summary.score,
			summary.reaches_root
		FROM nodes target
		CROSS JOIN summary
		WHERE target.id = $1::uuid
		  AND target.deleted_at IS NULL
	`, nodeID, userID).Scan(&ownerID, &score, &reachesRoot)

	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return None, ErrNotFound
	}
	if err != nil {
		return None, fmt.Errorf("resolve folder permission: %w", err)
	}
	if !reachesRoot {
		return None, ErrNotFound
	}
	if admin || ownerID == userID {
		return Full, nil
	}

	return Level(score), nil
}

func folderOwner(ctx context.Context, tx pgx.Tx, folderID string) (string, error) {
	var ownerID, kind string
	err := tx.QueryRow(ctx, `
		SELECT owner_user_id::text, kind
		FROM nodes
		WHERE id = $1::uuid
		  AND deleted_at IS NULL
	`, folderID).Scan(&ownerID, &kind)

	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get folder: %w", err)
	}
	if kind != "folder" {
		return "", ErrNotFolder
	}

	return ownerID, nil
}

func requireFolder(ctx context.Context, db queryRower, folderID string) error {
	var kind string
	err := db.QueryRow(ctx, `
		SELECT kind
		FROM nodes
		WHERE id = $1::uuid
		  AND deleted_at IS NULL
	`, folderID).Scan(&kind)

	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("get folder: %w", err)
	}
	if kind != "folder" {
		return ErrNotFolder
	}
	return nil
}

func lockOwnerTree(ctx context.Context, tx pgx.Tx, ownerID string) error {
	if _, err := tx.Exec(ctx, `
		SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
	`, ownerID); err != nil {
		return fmt.Errorf("lock owner tree: %w", err)
	}
	return nil
}

func isInvalidUUID(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "22P02"
}
