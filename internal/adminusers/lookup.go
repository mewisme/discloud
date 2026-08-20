package adminusers

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s *Service) GetByUsername(ctx context.Context, username string) (User, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return User{}, ErrUserNotFound
	}

	var user User
	err := s.pool.QueryRow(ctx, `
		SELECT
			id::text,
			username::text,
			role,
			status,
			storage_quota_bytes,
			storage_used_bytes,
			storage_reserved_bytes,
			must_change_password,
			created_at,
			updated_at,
			disabled_at
		FROM users
		WHERE username = $1
	`, username).Scan(
		&user.ID,
		&user.Username,
		&user.Role,
		&user.Status,
		&user.StorageQuotaBytes,
		&user.StorageUsedBytes,
		&user.StorageReservedBytes,
		&user.MustChangePassword,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.DisabledAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("get user by username: %w", err)
	}
	return user, nil
}
