package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	mfadomain "github.com/mewisme/discloud/internal/mfa"
	"github.com/mewisme/discloud/internal/postgres"
)

const mfaChallengeTTL = 5 * time.Minute

var (
	ErrInvalidMFA     = errors.New("invalid MFA challenge or code")
	ErrMFAUnavailable = errors.New("MFA service unavailable")
)

func (s *Service) MFAEnabled(ctx context.Context, userID string) (bool, error) {
	var enabled bool
	if err := s.pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM mfa_totp WHERE user_id = $1)", userID).Scan(&enabled); err != nil {
		return false, fmt.Errorf("check MFA status: %w", err)
	}
	return enabled, nil
}

func (s *Service) EnrollMFA(ctx context.Context, userID, username string) (*mfadomain.Enrollment, error) {
	if s.mfa == nil {
		return nil, ErrMFAUnavailable
	}
	return s.mfa.Enroll(ctx, userID, username)
}

func (s *Service) ConfirmMFA(ctx context.Context, userID, code string) (*mfadomain.Confirmation, error) {
	if s.mfa == nil {
		return nil, ErrMFAUnavailable
	}
	return s.mfa.Confirm(ctx, userID, code)
}

func (s *Service) RegenerateRecoveryCodes(ctx context.Context, userID, code string) (*mfadomain.Confirmation, error) {
	if s.mfa == nil {
		return nil, ErrMFAUnavailable
	}
	return s.mfa.RegenerateRecoveryCodes(ctx, userID, code)
}

func (s *Service) DisableMFA(ctx context.Context, userID, currentSessionID, code string) error {
	if s.mfa == nil {
		return ErrMFAUnavailable
	}
	return s.mfa.Disable(ctx, userID, currentSessionID, code)
}

func (s *Service) ResetMFA(ctx context.Context, targetUserID, actorUserID, requestID, ipAddress string) error {
	if s.mfa == nil {
		return ErrMFAUnavailable
	}
	return s.mfa.Reset(ctx, targetUserID, actorUserID, requestID, ipAddress)
}

func (s *Service) createMFAChallenge(ctx context.Context, userID string) (string, time.Time, error) {
	token, tokenHash, err := newOpaqueToken()
	if err != nil {
		return "", time.Time{}, err
	}

	expiresAt := time.Now().UTC().Add(mfaChallengeTTL)
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO login_challenges (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, userID, tokenHash[:], expiresAt); err != nil {
		return "", time.Time{}, fmt.Errorf("create MFA challenge: %w", err)
	}

	return token, expiresAt, nil
}

func (s *Service) verifyMFAChallenge(ctx context.Context, token, code string) (string, error) {
	if token == "" || strings.TrimSpace(code) == "" {
		return "", ErrInvalidMFA
	}
	if s.mfa == nil {
		return "", ErrMFAUnavailable
	}

	tokenHash := hashOpaqueToken(token)
	var userID string

	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			SELECT c.user_id::text
			FROM login_challenges c
			JOIN users u ON u.id = c.user_id
			WHERE c.token_hash = $1
			  AND c.consumed_at IS NULL
			  AND c.expires_at > now()
			  AND u.status = 'active'
		`, tokenHash[:]).Scan(&userID)

		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidMFA
		}
		if err != nil {
			return fmt.Errorf("read MFA challenge: %w", err)
		}

		if err := s.mfa.VerifyCode(ctx, tx, userID, code); err != nil {
			if errors.Is(err, mfadomain.ErrInvalidCode) || errors.Is(err, mfadomain.ErrNotEnabled) || errors.Is(err, mfadomain.ErrUserNotFound) {
				return ErrInvalidMFA
			}
			return err
		}

		tag, err := tx.Exec(ctx, `
			UPDATE login_challenges
			SET consumed_at = now()
			WHERE token_hash = $1
			  AND user_id = $2
			  AND consumed_at IS NULL
			  AND expires_at > now()
		`, tokenHash[:], userID)
		if err != nil {
			return fmt.Errorf("consume MFA challenge: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrInvalidMFA
		}

		return nil
	})
	if err != nil {
		return "", err
	}

	return userID, nil
}
