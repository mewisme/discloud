package mfa

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pquerna/otp/totp"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/encryption"
	"github.com/mewisme/discloud/internal/postgres"
)

const (
	enrollmentTTL = 10 * time.Minute
	keyVersion    = 1
)

var (
	ErrAlreadyEnabled     = errors.New("MFA is already enabled")
	ErrNotEnabled         = errors.New("MFA is not enabled")
	ErrEnrollmentNotFound = errors.New("MFA enrollment not found or expired")
	ErrInvalidCode        = errors.New("invalid authentication code")
	ErrUserNotFound       = errors.New("user not found")
)

type Service struct {
	pool      *pgxpool.Pool
	issuer    string
	masterKey []byte
}

type Enrollment struct {
	ProvisioningURI string
	ExpiresAt       time.Time
}

type Confirmation struct {
	RecoveryCodes []string
}

func New(pool *pgxpool.Pool, issuer string, masterKey []byte) *Service {
	return &Service{
		pool:      pool,
		issuer:    issuer,
		masterKey: append([]byte(nil), masterKey...),
	}
}

func (s *Service) Enroll(ctx context.Context, userID, username string) (*Enrollment, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      s.issuer,
		AccountName: username,
	})
	if err != nil {
		return nil, fmt.Errorf("generate TOTP secret: %w", err)
	}

	ciphertext, err := encryption.Seal(s.masterKey, []byte(key.Secret()))
	if err != nil {
		return nil, fmt.Errorf("encrypt TOTP secret: %w", err)
	}

	expiresAt := time.Now().UTC().Add(enrollmentTTL)
	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockUser(ctx, tx, userID); err != nil {
			return err
		}

		var enabled bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM mfa_totp WHERE user_id = $1)", userID).Scan(&enabled); err != nil {
			return fmt.Errorf("check MFA status: %w", err)
		}
		if enabled {
			return ErrAlreadyEnabled
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO mfa_enrollments (user_id, secret_ciphertext, key_version, expires_at)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (user_id) DO UPDATE
			SET secret_ciphertext = EXCLUDED.secret_ciphertext,
			    key_version = EXCLUDED.key_version,
			    created_at = now(),
			    expires_at = EXCLUDED.expires_at
		`, userID, ciphertext, keyVersion, expiresAt); err != nil {
			return fmt.Errorf("save MFA enrollment: %w", err)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &Enrollment{
		ProvisioningURI: key.URL(),
		ExpiresAt:       expiresAt,
	}, nil
}

func (s *Service) Confirm(ctx context.Context, userID, code string) (*Confirmation, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, ErrInvalidCode
	}

	var codes []string
	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockUser(ctx, tx, userID); err != nil {
			return err
		}

		var ciphertext []byte
		err := tx.QueryRow(ctx, `
			SELECT secret_ciphertext
			FROM mfa_enrollments
			WHERE user_id = $1 AND expires_at > now()
			FOR UPDATE
		`, userID).Scan(&ciphertext)

		if errors.Is(err, pgx.ErrNoRows) {
			return ErrEnrollmentNotFound
		}
		if err != nil {
			return fmt.Errorf("read MFA enrollment: %w", err)
		}

		secret, err := encryption.Open(s.masterKey, ciphertext)
		if err != nil {
			return fmt.Errorf("decrypt TOTP secret: %w", err)
		}
		defer clear(secret)

		if !totp.Validate(code, string(secret)) {
			return ErrInvalidCode
		}

		generated, hashes, err := generateRecoveryCodes(recoveryCodeCount)
		if err != nil {
			return err
		}

		tag, err := tx.Exec(ctx, `
			INSERT INTO mfa_totp (user_id, secret_ciphertext, key_version)
			VALUES ($1, $2, $3)
			ON CONFLICT (user_id) DO NOTHING
		`, userID, ciphertext, keyVersion)
		if err != nil {
			return fmt.Errorf("enable MFA: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrAlreadyEnabled
		}

		if _, err := tx.Exec(ctx, "DELETE FROM mfa_enrollments WHERE user_id = $1", userID); err != nil {
			return fmt.Errorf("consume MFA enrollment: %w", err)
		}

		for _, hash := range hashes {
			if _, err := tx.Exec(ctx, `
				INSERT INTO mfa_recovery_codes (user_id, code_hash)
				VALUES ($1, $2)
			`, userID, hash); err != nil {
				return fmt.Errorf("save recovery code: %w", err)
			}
		}

		codes = generated
		return nil
	})
	if err != nil {
		return nil, err
	}

	return &Confirmation{RecoveryCodes: codes}, nil
}

func (s *Service) VerifyCode(ctx context.Context, tx pgx.Tx, userID, code string) error {
	code = strings.TrimSpace(code)
	if code == "" {
		return ErrInvalidCode
	}

	if err := lockUser(ctx, tx, userID); err != nil {
		return err
	}

	var ciphertext []byte
	err := tx.QueryRow(ctx, `
		SELECT secret_ciphertext
		FROM mfa_totp
		WHERE user_id = $1
		FOR UPDATE
	`, userID).Scan(&ciphertext)

	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotEnabled
	}
	if err != nil {
		return fmt.Errorf("read TOTP secret: %w", err)
	}

	secret, err := encryption.Open(s.masterKey, ciphertext)
	if err != nil {
		return fmt.Errorf("decrypt TOTP secret: %w", err)
	}
	defer clear(secret)

	if totp.Validate(code, string(secret)) {
		return nil
	}

	hash := HashRecoveryCode(code)
	tag, err := tx.Exec(ctx, `
		UPDATE mfa_recovery_codes
		SET used_at = now()
		WHERE user_id = $1
		  AND code_hash = $2
		  AND used_at IS NULL
	`, userID, hash[:])
	if err != nil {
		return fmt.Errorf("consume recovery code: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrInvalidCode
	}

	return nil
}

func (s *Service) RegenerateRecoveryCodes(ctx context.Context, userID, code string) (*Confirmation, error) {
	codes, hashes, err := generateRecoveryCodes(recoveryCodeCount)
	if err != nil {
		return nil, err
	}

	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := s.VerifyCode(ctx, tx, userID, code); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, "DELETE FROM mfa_recovery_codes WHERE user_id = $1", userID); err != nil {
			return fmt.Errorf("delete recovery codes: %w", err)
		}

		for _, hash := range hashes {
			if _, err := tx.Exec(ctx, `
				INSERT INTO mfa_recovery_codes (user_id, code_hash)
				VALUES ($1, $2)
			`, userID, hash); err != nil {
				return fmt.Errorf("save recovery code: %w", err)
			}
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return &Confirmation{RecoveryCodes: codes}, nil
}

func (s *Service) Disable(ctx context.Context, userID, currentSessionID, code string) error {
	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := s.VerifyCode(ctx, tx, userID, code); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, "DELETE FROM mfa_enrollments WHERE user_id = $1", userID); err != nil {
			return fmt.Errorf("delete MFA enrollment: %w", err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM login_challenges WHERE user_id = $1", userID); err != nil {
			return fmt.Errorf("delete MFA challenges: %w", err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM mfa_recovery_codes WHERE user_id = $1", userID); err != nil {
			return fmt.Errorf("delete recovery codes: %w", err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM mfa_totp WHERE user_id = $1", userID); err != nil {
			return fmt.Errorf("disable MFA: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			UPDATE sessions
			SET revoked_at = COALESCE(revoked_at, now())
			WHERE user_id = $1
			  AND id::text <> $2
			  AND revoked_at IS NULL
		`, userID, currentSessionID); err != nil {
			return fmt.Errorf("revoke other sessions: %w", err)
		}

		return nil
	})
}

func (s *Service) Reset(ctx context.Context, targetUserID, actorUserID, requestID, ipAddress string) error {
	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockUser(ctx, tx, targetUserID); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, "DELETE FROM mfa_enrollments WHERE user_id = $1", targetUserID); err != nil {
			return fmt.Errorf("delete MFA enrollment: %w", err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM login_challenges WHERE user_id = $1", targetUserID); err != nil {
			return fmt.Errorf("delete MFA challenges: %w", err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM mfa_recovery_codes WHERE user_id = $1", targetUserID); err != nil {
			return fmt.Errorf("delete recovery codes: %w", err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM mfa_totp WHERE user_id = $1", targetUserID); err != nil {
			return fmt.Errorf("reset MFA: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			UPDATE sessions
			SET revoked_at = COALESCE(revoked_at, now())
			WHERE user_id = $1 AND revoked_at IS NULL
		`, targetUserID); err != nil {
			return fmt.Errorf("revoke sessions: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actorUserID,
			Action:       "mfa.reset",
			ResourceType: "user",
			ResourceID:   targetUserID,
			RequestID:    requestID,
			IPAddress:    ipAddress,
		})
	})
}

func lockUser(ctx context.Context, tx pgx.Tx, userID string) error {
	var exists bool
	err := tx.QueryRow(ctx, `
		SELECT true
		FROM users
		WHERE id::text = $1
		FOR UPDATE
	`, userID).Scan(&exists)

	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUserNotFound
	}
	if err != nil {
		return fmt.Errorf("lock user: %w", err)
	}
	return nil
}
