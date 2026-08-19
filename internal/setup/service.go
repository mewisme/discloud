package setup

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/postgres"
)

const setupLockID int64 = 0x646973636c6f7564

var ErrAlreadySetup = errors.New("setup already completed")

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Required(ctx context.Context) (bool, error) {
	var required bool
	if err := s.pool.QueryRow(ctx, "SELECT NOT EXISTS (SELECT 1 FROM users)").Scan(&required); err != nil {
		return false, fmt.Errorf("check setup status: %w", err)
	}
	return required, nil
}

func (s *Service) Complete(ctx context.Context, username, password string) (string, error) {
	username, err := auth.NormalizeUsername(username)
	if err != nil {
		return "", err
	}
	if err := auth.ValidatePassword(password); err != nil {
		return "", err
	}

	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}

	var userID string
	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", setupLockID); err != nil {
			return fmt.Errorf("lock setup: %w", err)
		}

		var exists bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM users)").Scan(&exists); err != nil {
			return fmt.Errorf("check existing users: %w", err)
		}
		if exists {
			return ErrAlreadySetup
		}

		if err := tx.QueryRow(ctx, `
			INSERT INTO users (username, password_hash, role)
			VALUES ($1, $2, 'admin')
			RETURNING id::text
		`, username, passwordHash).Scan(&userID); err != nil {
			return fmt.Errorf("create admin: %w", err)
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO nodes (
				kind, owner_user_id, name, name_key, is_root, created_by
			)
			VALUES ('folder', $1, '', '', true, $1)
		`, userID); err != nil {
			return fmt.Errorf("create admin root: %w", err)
		}

		return nil
	})
	if err != nil {
		return "", err
	}

	return userID, nil
}
