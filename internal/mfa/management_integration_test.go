package mfa

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pquerna/otp/totp"

	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestMFAManagementIntegration(t *testing.T) {
	dsn := os.Getenv("DISCLOUD_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("DISCLOUD_TEST_DATABASE_DSN is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	adminPool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open admin pool: %v", err)
	}
	defer adminPool.Close()

	schema := fmt.Sprintf("discloud_mfa_management_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()

	if _, err := adminPool.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	defer adminPool.Exec(context.Background(), "DROP SCHEMA "+identifier+" CASCADE")

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse DSN: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("open isolated pool: %v", err)
	}
	defer pool.Close()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := migrate.Up(ctx, pool, migrations.FS, logger); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var userID, adminID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash)
		VALUES ('alice', 'hash')
		RETURNING id::text
	`).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ('admin', 'hash', 'admin')
		RETURNING id::text
	`).Scan(&adminID); err != nil {
		t.Fatalf("create admin: %v", err)
	}

	service := New(pool, "DisCloud", bytes.Repeat([]byte{1}, 32))

	secret, recoveryCodes := enableMFAForTest(t, ctx, service, userID)

	regenerated, err := service.RegenerateRecoveryCodes(ctx, userID, recoveryCodes[0])
	if err != nil {
		t.Fatalf("regenerate recovery codes: %v", err)
	}
	if len(regenerated.RecoveryCodes) != recoveryCodeCount {
		t.Fatalf("recovery codes = %d, want %d", len(regenerated.RecoveryCodes), recoveryCodeCount)
	}

	oldHash := HashRecoveryCode(recoveryCodes[1])
	var oldExists bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM mfa_recovery_codes
			WHERE user_id = $1 AND code_hash = $2
		)
	`, userID, oldHash[:]).Scan(&oldExists); err != nil {
		t.Fatalf("check old recovery code: %v", err)
	}
	if oldExists {
		t.Fatal("old recovery code survived regeneration")
	}

	currentSessionID := "10000000-0000-7000-8000-000000000001"
	otherSessionID := "10000000-0000-7000-8000-000000000002"

	if _, err := pool.Exec(ctx, `
		INSERT INTO sessions (id, user_id, token_hash, expires_at)
		VALUES
			($1, $3, decode('01', 'hex'), now() + interval '1 hour'),
			($2, $3, decode('02', 'hex'), now() + interval '1 hour')
	`, currentSessionID, otherSessionID, userID); err != nil {
		t.Fatalf("create sessions: %v", err)
	}

	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("generate disable code: %v", err)
	}

	if err := service.Disable(ctx, userID, currentSessionID, code); err != nil {
		t.Fatalf("disable MFA: %v", err)
	}

	var enabled bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM mfa_totp WHERE user_id = $1)", userID).Scan(&enabled); err != nil {
		t.Fatalf("check disabled MFA: %v", err)
	}
	if enabled {
		t.Fatal("MFA remained enabled")
	}

	var currentRevoked, otherRevoked bool
	if err := pool.QueryRow(ctx, `
		SELECT revoked_at IS NOT NULL
		FROM sessions
		WHERE id = $1
	`, currentSessionID).Scan(&currentRevoked); err != nil {
		t.Fatalf("check current session: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		SELECT revoked_at IS NOT NULL
		FROM sessions
		WHERE id = $1
	`, otherSessionID).Scan(&otherRevoked); err != nil {
		t.Fatalf("check other session: %v", err)
	}

	if currentRevoked {
		t.Fatal("current session was revoked")
	}
	if !otherRevoked {
		t.Fatal("other session was not revoked")
	}

	enableMFAForTest(t, ctx, service, userID)

	if err := service.Reset(ctx, userID, adminID, "request-1", "127.0.0.1"); err != nil {
		t.Fatalf("admin reset MFA: %v", err)
	}

	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM mfa_totp WHERE user_id = $1)", userID).Scan(&enabled); err != nil {
		t.Fatalf("check reset MFA: %v", err)
	}
	if enabled {
		t.Fatal("MFA remained enabled after reset")
	}

	var activeSessions int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM sessions
		WHERE user_id = $1 AND revoked_at IS NULL
	`, userID).Scan(&activeSessions); err != nil {
		t.Fatalf("count active sessions: %v", err)
	}
	if activeSessions != 0 {
		t.Fatalf("active sessions = %d, want 0", activeSessions)
	}

	var audited bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM audit_events
			WHERE actor_user_id = $1
			  AND resource_id = $2
			  AND action = 'mfa.reset'
		)
	`, adminID, userID).Scan(&audited); err != nil {
		t.Fatalf("check audit event: %v", err)
	}
	if !audited {
		t.Fatal("MFA reset was not audited")
	}
}

func enableMFAForTest(t *testing.T, ctx context.Context, service *Service, userID string) (string, []string) {
	t.Helper()

	enrollment, err := service.Enroll(ctx, userID, "alice")
	if err != nil {
		t.Fatalf("enroll MFA: %v", err)
	}

	uri, err := url.Parse(enrollment.ProvisioningURI)
	if err != nil {
		t.Fatalf("parse provisioning URI: %v", err)
	}

	secret := uri.Query().Get("secret")
	if secret == "" {
		t.Fatal("missing TOTP secret")
	}

	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("generate confirmation code: %v", err)
	}

	confirmation, err := service.Confirm(ctx, userID, code)
	if err != nil {
		t.Fatalf("confirm MFA: %v", err)
	}

	return secret, confirmation.RecoveryCodes
}
