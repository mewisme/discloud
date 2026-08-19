package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/mewisme/discloud/internal/postgres"
)

var (
	ErrUsernameTaken   = errors.New("username already exists")
	ErrCurrentPassword = errors.New("current password is incorrect")
	ErrPasswordChanged = errors.New("password changed concurrently")
	ErrSessionNotFound = errors.New("session not found")
)

type Session struct {
	ID        string
	CreatedAt time.Time
	ExpiresAt time.Time
	Current   bool
}

type Usage struct {
	QuotaBytes     *int64
	UsedBytes      int64
	ReservedBytes  int64
	AvailableBytes *int64
	OverQuota      bool
}

func (s *Service) Usage(ctx context.Context, userID string) (Usage, error) {
	var usage Usage
	if err := s.pool.QueryRow(ctx, `
		SELECT storage_quota_bytes, storage_used_bytes, storage_reserved_bytes
		FROM users
		WHERE id = $1
	`, userID).Scan(&usage.QuotaBytes, &usage.UsedBytes, &usage.ReservedBytes); err != nil {
		return Usage{}, fmt.Errorf("get usage: %w", err)
	}
	if usage.QuotaBytes != nil {
		available := *usage.QuotaBytes - usage.UsedBytes - usage.ReservedBytes
		if available < 0 {
			usage.OverQuota = true
			available = 0
		}
		usage.AvailableBytes = &available
	}
	return usage, nil
}

func (s *Service) ListSessions(ctx context.Context, userID, currentSessionID string) ([]Session, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, created_at, expires_at
		FROM sessions
		WHERE user_id = $1
		  AND revoked_at IS NULL
		  AND expires_at > now()
		ORDER BY created_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	sessions := make([]Session, 0)
	for rows.Next() {
		var session Session
		if err := rows.Scan(&session.ID, &session.CreatedAt, &session.ExpiresAt); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		session.Current = session.ID == currentSessionID
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read sessions: %w", err)
	}
	return sessions, nil
}

func (s *Service) RevokeSession(ctx context.Context, userID, sessionID string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = COALESCE(revoked_at, now())
		WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
	`, sessionID, userID)
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrSessionNotFound
	}
	return nil
}

func (s *Service) RevokeOtherSessions(ctx context.Context, userID, currentSessionID string) error {
	if _, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = COALESCE(revoked_at, now())
		WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL
	`, userID, currentSessionID); err != nil {
		return fmt.Errorf("revoke other sessions: %w", err)
	}
	return nil
}

func (s *Service) UpdateUsername(ctx context.Context, userID, username string) (User, error) {
	username, err := NormalizeUsername(username)
	if err != nil {
		return User{}, err
	}

	var user User
	err = s.pool.QueryRow(ctx, `
		UPDATE users
		SET username = $2, updated_at = now()
		WHERE id = $1
		RETURNING id::text, username::text, role, must_change_password
	`, userID, username).Scan(&user.ID, &user.Username, &user.Role, &user.MustChangePassword)
	if err == nil {
		return user, nil
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return User{}, ErrUsernameTaken
	}
	return User{}, fmt.Errorf("update username: %w", err)
}

func (s *Service) ChangePassword(ctx context.Context, userID, currentSessionID, currentPassword, newPassword string) error {
	if err := ValidatePassword(newPassword); err != nil {
		return err
	}

	var oldHash string
	if err := s.pool.QueryRow(ctx, "SELECT password_hash FROM users WHERE id = $1", userID).Scan(&oldHash); err != nil {
		return fmt.Errorf("read password hash: %w", err)
	}

	match, err := VerifyPassword(currentPassword, oldHash)
	if err != nil {
		return fmt.Errorf("verify current password: %w", err)
	}
	if !match {
		return ErrCurrentPassword
	}

	newHash, err := HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("hash new password: %w", err)
	}

	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE users
			SET password_hash = $2,
			    password_changed_at = now(),
			    updated_at = now(),
			    must_change_password = false
			WHERE id = $1 AND password_hash = $3
		`, userID, newHash, oldHash)
		if err != nil {
			return fmt.Errorf("update password: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrPasswordChanged
		}

		if _, err := tx.Exec(ctx, `
			UPDATE sessions
			SET revoked_at = COALESCE(revoked_at, now())
			WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL
		`, userID, currentSessionID); err != nil {
			return fmt.Errorf("revoke other sessions: %w", err)
		}
		return nil
	})
}
