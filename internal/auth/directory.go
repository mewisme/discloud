package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

var ErrUserLookupNotFound = errors.New("user not found")

type UserLookup struct {
	ID       string
	Username string
}

func (s *Service) LookupActiveUser(ctx context.Context, username string) (UserLookup, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return UserLookup{}, ErrUserLookupNotFound
	}

	var user UserLookup
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, username::text
		FROM users
		WHERE username = $1
		  AND status = 'active'
	`, username).Scan(&user.ID, &user.Username)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserLookup{}, ErrUserLookupNotFound
	}
	if err != nil {
		return UserLookup{}, fmt.Errorf("lookup active user: %w", err)
	}
	return user, nil
}
