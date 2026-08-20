package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	mfadomain "github.com/mewisme/discloud/internal/mfa"
)

var (
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrUnauthenticated    = errors.New("unauthenticated")
)

type User struct {
	ID                 string
	Username           string
	Role               string
	MustChangePassword bool
	HasAvatar          bool
	AvatarRevision     int64
}

type LoginResult struct {
	Token              string
	ExpiresAt          time.Time
	User               User
	MFARequired        bool
	ChallengeToken     string
	ChallengeExpiresAt time.Time
}

type Principal struct {
	SessionID string
	User      User
}

type Service struct {
	pool       *pgxpool.Pool
	sessionTTL time.Duration
	mfa        *mfadomain.Service
}

func New(pool *pgxpool.Pool, sessionTTL time.Duration) *Service {
	return &Service{pool: pool, sessionTTL: sessionTTL}
}

func NewWithMFA(pool *pgxpool.Pool, sessionTTL time.Duration, issuer string, masterKey []byte) *Service {
	service := New(pool, sessionTTL)
	service.mfa = mfadomain.New(pool, issuer, masterKey)
	return service
}

func (s *Service) Login(ctx context.Context, username, password, userAgent, ipAddress string) (*LoginResult, error) {
	username = strings.TrimSpace(username)

	var user User
	var passwordHash, status string
	err := s.pool.QueryRow(ctx, `
		SELECT
			id::text,
			username::text,
			role,
			status,
			password_hash,
			must_change_password,
			avatar_object_id IS NOT NULL,
			avatar_revision
		FROM users
		WHERE username = $1
	`, username).Scan(
		&user.ID,
		&user.Username,
		&user.Role,
		&status,
		&passwordHash,
		&user.MustChangePassword,
		&user.HasAvatar,
		&user.AvatarRevision,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		if _, hashErr := HashPassword(password); hashErr != nil {
			return nil, fmt.Errorf("dummy password hash: %w", hashErr)
		}
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, fmt.Errorf("find user: %w", err)
	}

	match, err := VerifyPassword(password, passwordHash)
	if err != nil {
		return nil, fmt.Errorf("verify password: %w", err)
	}
	if !match || status != "active" {
		return nil, ErrInvalidCredentials
	}

	var mfaEnabled bool
	if err := s.pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM mfa_totp WHERE user_id = $1)", user.ID).Scan(&mfaEnabled); err != nil {
		return nil, fmt.Errorf("check MFA status: %w", err)
	}

	if mfaEnabled {
		if s.mfa == nil {
			return nil, ErrMFAUnavailable
		}

		token, expiresAt, err := s.createMFAChallenge(ctx, user.ID)
		if err != nil {
			return nil, err
		}

		return &LoginResult{
			MFARequired:        true,
			ChallengeToken:     token,
			ChallengeExpiresAt: expiresAt,
		}, nil
	}

	return s.createSession(ctx, user, userAgent, ipAddress)
}

func (s *Service) CompleteMFA(ctx context.Context, challengeToken, code, userAgent, ipAddress string) (*LoginResult, error) {
	userID, err := s.verifyMFAChallenge(ctx, challengeToken, code)
	if err != nil {
		return nil, err
	}

	var user User
	err = s.pool.QueryRow(ctx, `
		SELECT
			id::text,
			username::text,
			role,
			must_change_password,
			avatar_object_id IS NOT NULL,
			avatar_revision
		FROM users
		WHERE id = $1 AND status = 'active'
	`, userID).Scan(
		&user.ID,
		&user.Username,
		&user.Role,
		&user.MustChangePassword,
		&user.HasAvatar,
		&user.AvatarRevision,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnauthenticated
	}
	if err != nil {
		return nil, fmt.Errorf("read MFA user: %w", err)
	}

	return s.createSession(ctx, user, userAgent, ipAddress)
}

func (s *Service) createSession(ctx context.Context, user User, userAgent, ipAddress string) (*LoginResult, error) {
	token, tokenHash, err := newOpaqueToken()
	if err != nil {
		return nil, err
	}

	expiresAt := time.Now().UTC().Add(s.sessionTTL)
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO sessions (user_id, token_hash, user_agent, ip_address, expires_at)
		VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, '')::inet, $5)
	`, user.ID, tokenHash[:], userAgent, ipAddress, expiresAt); err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}

	return &LoginResult{
		Token:     token,
		ExpiresAt: expiresAt,
		User:      user,
	}, nil
}

func (s *Service) Authenticate(ctx context.Context, token string) (*Principal, error) {
	if token == "" {
		return nil, ErrUnauthenticated
	}

	tokenHash := hashOpaqueToken(token)
	var principal Principal

	err := s.pool.QueryRow(ctx, `
		SELECT
			s.id::text,
			u.id::text,
			u.username::text,
			u.role,
			u.must_change_password,
			u.avatar_object_id IS NOT NULL,
			u.avatar_revision
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1
		  AND s.revoked_at IS NULL
		  AND s.expires_at > now()
		  AND u.status = 'active'
	`, tokenHash[:]).Scan(
		&principal.SessionID,
		&principal.User.ID,
		&principal.User.Username,
		&principal.User.Role,
		&principal.User.MustChangePassword,
		&principal.User.HasAvatar,
		&principal.User.AvatarRevision,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnauthenticated
	}
	if err != nil {
		return nil, fmt.Errorf("authenticate session: %w", err)
	}

	return &principal, nil
}

func (s *Service) RevokeToken(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}

	tokenHash := hashOpaqueToken(token)
	if _, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = COALESCE(revoked_at, now())
		WHERE token_hash = $1
	`, tokenHash[:]); err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}

	return nil
}
