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

func TestEnrollmentAndConfirmationIntegration(t *testing.T) {
	dsn := os.Getenv("DISCLOUD_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("DISCLOUD_TEST_DATABASE_DSN is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open admin pool: %v", err)
	}
	defer admin.Close()

	schema := fmt.Sprintf("discloud_mfa_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()

	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	defer admin.Exec(context.Background(), "DROP SCHEMA "+identifier+" CASCADE")

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

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash)
		VALUES ('alice', 'test-hash')
		RETURNING id::text
	`).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	service := New(pool, "DisCloud", bytes.Repeat([]byte{1}, 32))

	enrollment, err := service.Enroll(ctx, userID, "alice")
	if err != nil {
		t.Fatalf("enroll: %v", err)
	}
	if enrollment.ProvisioningURI == "" {
		t.Fatal("provisioning URI is empty")
	}

	uri, err := url.Parse(enrollment.ProvisioningURI)
	if err != nil {
		t.Fatalf("parse provisioning URI: %v", err)
	}

	secret := uri.Query().Get("secret")
	if secret == "" {
		t.Fatal("provisioning URI has no secret")
	}

	var ciphertext []byte
	if err := pool.QueryRow(ctx, "SELECT secret_ciphertext FROM mfa_enrollments WHERE user_id = $1", userID).Scan(&ciphertext); err != nil {
		t.Fatalf("read enrollment ciphertext: %v", err)
	}
	if bytes.Contains(ciphertext, []byte(secret)) {
		t.Fatal("database ciphertext contains plaintext TOTP secret")
	}

	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("generate TOTP code: %v", err)
	}

	confirmation, err := service.Confirm(ctx, userID, code)
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if len(confirmation.RecoveryCodes) != recoveryCodeCount {
		t.Fatalf("recovery codes = %d, want %d", len(confirmation.RecoveryCodes), recoveryCodeCount)
	}

	var enabled bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM mfa_totp WHERE user_id = $1)", userID).Scan(&enabled); err != nil {
		t.Fatalf("check MFA: %v", err)
	}
	if !enabled {
		t.Fatal("MFA was not enabled")
	}

	var pending int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM mfa_enrollments WHERE user_id = $1", userID).Scan(&pending); err != nil {
		t.Fatalf("count enrollments: %v", err)
	}
	if pending != 0 {
		t.Fatalf("pending enrollments = %d, want 0", pending)
	}

	var storedCodes int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM mfa_recovery_codes WHERE user_id = $1", userID).Scan(&storedCodes); err != nil {
		t.Fatalf("count recovery codes: %v", err)
	}
	if storedCodes != recoveryCodeCount {
		t.Fatalf("stored recovery codes = %d, want %d", storedCodes, recoveryCodeCount)
	}
}
