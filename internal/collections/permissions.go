package collections

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/postgres"
)

type Grant struct {
	UserID    string
	Username  string
	Level     Level
	CreatedBy string
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (s *Service) ListGrants(ctx context.Context, actor Actor, collectionID string) ([]Grant, error) {
	state, err := loadState(ctx, s.pool, collectionID, false, false)
	if err != nil {
		return nil, err
	}
	if err := requireLevel(ctx, s.pool, state, actor, Full); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			cp.user_id::text,
			u.username::text,
			cp.level,
			cp.created_by::text,
			cp.created_at,
			cp.updated_at
		FROM collection_permissions cp
		JOIN users u ON u.id = cp.user_id
		WHERE cp.collection_id = $1::uuid
		ORDER BY u.username, cp.user_id
	`, collectionID)
	if err != nil {
		return nil, fmt.Errorf("list collection grants: %w", err)
	}
	defer rows.Close()

	grants := make([]Grant, 0)
	for rows.Next() {
		var grant Grant
		var level string
		if err := rows.Scan(
			&grant.UserID, &grant.Username, &level, &grant.CreatedBy,
			&grant.CreatedAt, &grant.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan collection grant: %w", err)
		}

		grant.Level, err = ParseLevel(level)
		if err != nil {
			return nil, err
		}
		grants = append(grants, grant)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read collection grants: %w", err)
	}
	return grants, nil
}

func (s *Service) SetGrant(ctx context.Context, actor Actor, collectionID, userID string, level Level) (Grant, error) {
	if level < View || level > Full {
		return Grant{}, ErrInvalidLevel
	}

	var grant Grant
	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		state, err := loadState(ctx, tx, collectionID, false, true)
		if err != nil {
			return err
		}
		if err := requireLevel(ctx, tx, state, actor, Full); err != nil {
			return err
		}
		if state.OwnerID == userID {
			return ErrOwnerGrant
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
			return fmt.Errorf("get collection grantee: %w", err)
		}

		var storedLevel string
		err = tx.QueryRow(ctx, `
			INSERT INTO collection_permissions (collection_id, user_id, level, created_by)
			VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
			ON CONFLICT (collection_id, user_id) DO UPDATE
			SET level = EXCLUDED.level, updated_at = now()
			RETURNING level, created_by::text, created_at, updated_at
		`, collectionID, userID, level.String(), actor.UserID).Scan(
			&storedLevel, &grant.CreatedBy, &grant.CreatedAt, &grant.UpdatedAt,
		)
		if err != nil {
			return fmt.Errorf("set collection grant: %w", err)
		}

		grant.Level, err = ParseLevel(storedLevel)
		if err != nil {
			return err
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID: actor.UserID, Action: "collection.permission_set",
			ResourceType: "collection", ResourceID: collectionID,
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

func (s *Service) DeleteGrant(ctx context.Context, actor Actor, collectionID, userID string) error {
	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		state, err := loadState(ctx, tx, collectionID, false, true)
		if err != nil {
			return err
		}
		if err := requireLevel(ctx, tx, state, actor, Full); err != nil {
			return err
		}

		tag, err := tx.Exec(ctx, `
			DELETE FROM collection_permissions
			WHERE collection_id = $1::uuid
			  AND user_id = $2::uuid
		`, collectionID, userID)
		if isInvalidUUID(err) {
			return ErrGrantNotFound
		}
		if err != nil {
			return fmt.Errorf("delete collection grant: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrGrantNotFound
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID: actor.UserID, Action: "collection.permission_delete",
			ResourceType: "collection", ResourceID: collectionID,
			Metadata: map[string]any{"userId": userID},
		})
	})
}
