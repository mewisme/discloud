package shares

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/postgres"
)

const publicShareSessionTTL = 24 * time.Hour

var (
	ErrInvalidPolicy    = errors.New("invalid public share policy")
	ErrPasswordRequired = errors.New("public share password required")
	ErrInvalidPassword  = errors.New("invalid public share password")
	ErrExpired          = errors.New("public share expired")
	ErrViewLimit        = errors.New("public share view limit reached")
	ErrDownloadDisabled = errors.New("public share downloads disabled")
	ErrDownloadLimit    = errors.New("public share download limit reached")
)

type UpdateInput struct {
	ExpiresAt     *time.Time
	Password      *string
	ClearPassword bool
	AllowDownload bool
	MaxViews      *int64
	MaxDownloads  *int64
}

type UnlockResult struct {
	Token     string
	ExpiresAt time.Time
}

type preparedSharePolicy struct {
	expiresAt     *time.Time
	passwordHash  string
	allowDownload bool
	maxViews      *int64
	maxDownloads  *int64
}

func prepareCreatePolicy(input CreateInput) (preparedSharePolicy, error) {
	allowDownload := true
	if input.AllowDownload != nil {
		allowDownload = *input.AllowDownload
	}
	policy := preparedSharePolicy{
		expiresAt: input.ExpiresAt, allowDownload: allowDownload,
		maxViews: input.MaxViews, maxDownloads: input.MaxDownloads,
	}
	if err := validatePolicy(policy.expiresAt, policy.maxViews, policy.maxDownloads); err != nil {
		return preparedSharePolicy{}, err
	}
	if input.Password != "" {
		if err := auth.ValidatePassword(input.Password); err != nil {
			return preparedSharePolicy{}, fmt.Errorf("%w: %v", ErrInvalidPolicy, err)
		}
		hash, err := auth.HashPassword(input.Password)
		if err != nil {
			return preparedSharePolicy{}, fmt.Errorf("hash public share password: %w", err)
		}
		policy.passwordHash = hash
	}
	return policy, nil
}

func validatePolicy(expiresAt *time.Time, maxViews, maxDownloads *int64) error {
	if expiresAt != nil && !expiresAt.After(time.Now()) {
		return fmt.Errorf("%w: expiration must be in the future", ErrInvalidPolicy)
	}
	if maxViews != nil && *maxViews <= 0 {
		return fmt.Errorf("%w: max views must be greater than zero", ErrInvalidPolicy)
	}
	if maxDownloads != nil && *maxDownloads <= 0 {
		return fmt.Errorf("%w: max downloads must be greater than zero", ErrInvalidPolicy)
	}
	return nil
}

func finalizeSharePolicy(share *Share) {
	share.PasswordProtected = share.passwordHash != ""
}

func (s *Service) Update(ctx context.Context, actor Actor, shareID string, input UpdateInput) (Share, error) {
	if err := validatePolicy(input.ExpiresAt, input.MaxViews, input.MaxDownloads); err != nil {
		return Share{}, err
	}
	if input.Password != nil && input.ClearPassword {
		return Share{}, fmt.Errorf("%w: password and clearPassword are mutually exclusive", ErrInvalidPolicy)
	}

	passwordHash := ""
	passwordChanged := input.Password != nil || input.ClearPassword
	if input.Password != nil {
		if err := auth.ValidatePassword(*input.Password); err != nil {
			return Share{}, fmt.Errorf("%w: %v", ErrInvalidPolicy, err)
		}
		hash, err := auth.HashPassword(*input.Password)
		if err != nil {
			return Share{}, fmt.Errorf("hash public share password: %w", err)
		}
		passwordHash = hash
	}

	var updated Share
	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		share, err := loadShareByID(ctx, tx, shareID, true)
		if err != nil {
			return err
		}
		if err := s.authorizeResourceTx(ctx, tx, actor, share.ResourceType, share.ResourceID); err != nil {
			return err
		}

		tag, err := tx.Exec(ctx, `
			UPDATE public_shares
			SET expires_at = $2,
				allow_download = $3,
				max_views = $4,
				max_downloads = $5,
				password_hash = CASE WHEN $6 THEN NULLIF($7, '') ELSE password_hash END
			WHERE id = $1::uuid
			  AND revoked_at IS NULL
		`, share.ID, input.ExpiresAt, input.AllowDownload, input.MaxViews, input.MaxDownloads, passwordChanged, passwordHash)
		if err != nil {
			return fmt.Errorf("update public share: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrNotFound
		}
		if passwordChanged {
			if _, err := tx.Exec(ctx, `DELETE FROM public_share_sessions WHERE share_id = $1::uuid`, share.ID); err != nil {
				return fmt.Errorf("revoke public share sessions after password change: %w", err)
			}
		}

		updated, err = loadShareByID(ctx, tx, share.ID, true)
		if err != nil {
			return err
		}
		return audit.Append(ctx, tx, audit.Event{
			ActorUserID: actor.UserID, Action: "share.update", ResourceType: "share", ResourceID: share.ID,
			Metadata: map[string]any{"resourceType": share.ResourceType, "resourceId": share.ResourceID},
		})
	})
	return updated, err
}

func (s *Service) RevokeSessions(ctx context.Context, actor Actor, shareID string) error {
	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		share, err := loadShareByID(ctx, tx, shareID, true)
		if err != nil {
			return err
		}
		if err := s.authorizeResourceTx(ctx, tx, actor, share.ResourceType, share.ResourceID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM public_share_sessions WHERE share_id = $1::uuid`, share.ID); err != nil {
			return fmt.Errorf("revoke public share sessions: %w", err)
		}
		return audit.Append(ctx, tx, audit.Event{
			ActorUserID: actor.UserID, Action: "share.sessions.revoke", ResourceType: "share", ResourceID: share.ID,
		})
	})
}

func (s *Service) Unlock(ctx context.Context, publicID, password string) (UnlockResult, error) {
	share, err := s.Resolve(ctx, publicID)
	if err != nil {
		return UnlockResult{}, err
	}
	if err := validateShareAvailability(share); err != nil {
		return UnlockResult{}, err
	}
	if !share.PasswordProtected {
		return UnlockResult{}, nil
	}
	ok, err := auth.VerifyPassword(password, share.passwordHash)
	if err != nil {
		return UnlockResult{}, fmt.Errorf("verify public share password: %w", err)
	}
	if !ok {
		return UnlockResult{}, ErrInvalidPassword
	}

	token, tokenHash, err := newSessionToken()
	if err != nil {
		return UnlockResult{}, err
	}
	now := time.Now()
	expiresAt := now.Add(publicShareSessionTTL)
	if share.ExpiresAt != nil && share.ExpiresAt.Before(expiresAt) {
		expiresAt = *share.ExpiresAt
	}
	if !expiresAt.After(now) {
		return UnlockResult{}, ErrExpired
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO public_share_sessions (share_id, token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)
	`, share.ID, tokenHash, expiresAt)
	if err != nil {
		return UnlockResult{}, fmt.Errorf("create public share session: %w", err)
	}
	_, _ = s.pool.Exec(ctx, `DELETE FROM public_share_sessions WHERE expires_at <= now()`)
	return UnlockResult{Token: token, ExpiresAt: expiresAt}, nil
}

func (s *Service) ResolvePublic(ctx context.Context, publicID, token string) (Share, error) {
	share, err := s.Resolve(ctx, publicID)
	if err != nil {
		return Share{}, err
	}
	if err := validateShareAvailability(share); err != nil {
		return Share{}, err
	}
	if !share.PasswordProtected {
		return share, nil
	}
	if token == "" {
		return Share{}, ErrPasswordRequired
	}
	hash := sha256.Sum256([]byte(token))
	var ok bool
	err = s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM public_share_sessions
			WHERE share_id = $1::uuid AND token_hash = $2 AND expires_at > now()
		)
	`, share.ID, hash[:]).Scan(&ok)
	if err != nil {
		return Share{}, fmt.Errorf("validate public share session: %w", err)
	}
	if !ok {
		return Share{}, ErrPasswordRequired
	}
	return share, nil
}

func (s *Service) ConsumeView(ctx context.Context, publicID, token string) (Share, error) {
	share, err := s.ResolvePublic(ctx, publicID, token)
	if err != nil {
		return Share{}, err
	}
	err = s.pool.QueryRow(ctx, `
		UPDATE public_shares
		SET view_count = view_count + 1
		WHERE id = $1::uuid
		  AND revoked_at IS NULL
		  AND (expires_at IS NULL OR expires_at > now())
		  AND (max_views IS NULL OR view_count < max_views)
		RETURNING view_count
	`, share.ID).Scan(&share.ViewCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return Share{}, ErrViewLimit
	}
	if err != nil {
		return Share{}, fmt.Errorf("consume public share view: %w", err)
	}
	return share, nil
}

func (s *Service) ConsumeDownload(ctx context.Context, shareID string) (int64, error) {
	var count int64
	err := s.pool.QueryRow(ctx, `
		UPDATE public_shares
		SET download_count = download_count + 1
		WHERE id = $1::uuid
		  AND revoked_at IS NULL
		  AND allow_download
		  AND (expires_at IS NULL OR expires_at > now())
		  AND (max_downloads IS NULL OR download_count < max_downloads)
		RETURNING download_count
	`, shareID).Scan(&count)
	if err == nil {
		return count, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, fmt.Errorf("consume public share download: %w", err)
	}

	share, loadErr := loadShareByID(ctx, s.pool, shareID, true)
	if loadErr != nil {
		return 0, loadErr
	}
	if share.ExpiresAt != nil && !share.ExpiresAt.After(time.Now()) {
		return 0, ErrExpired
	}
	if !share.AllowDownload {
		return 0, ErrDownloadDisabled
	}
	return 0, ErrDownloadLimit
}

func validateShareAvailability(share Share) error {
	if share.ExpiresAt != nil && !share.ExpiresAt.After(time.Now()) {
		return ErrExpired
	}
	return nil
}

func newSessionToken() (string, []byte, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", nil, fmt.Errorf("generate public share session: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw[:])
	hash := sha256.Sum256([]byte(token))
	return token, hash[:], nil
}
