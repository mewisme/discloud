package auth

import (
	"bytes"
	"context"
	"errors"
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

func TestMFALoginIntegration(t *testing.T) {
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

	schema := fmt.Sprintf("discloud_auth_mfa_test_%d", time.Now().UnixNano())
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

	password := "correct-horse-battery-staple"
	passwordHash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash)
		VALUES ('alice', $1)
		RETURNING id::text
	`, passwordHash).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	service := NewWithMFA(pool, time.Hour, "DisCloud", bytes.Repeat([]byte{1}, 32))

	enrollment, err := service.EnrollMFA(ctx, userID, "alice")
	if err != nil {
		t.Fatalf("enroll MFA: %v", err)
	}

	uri, err := url.Parse(enrollment.ProvisioningURI)
	if err != nil {
		t.Fatalf("parse provisioning URI: %v", err)
	}

	secret := uri.Query().Get("secret")
	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("generate confirmation code: %v", err)
	}

	confirmation, err := service.ConfirmMFA(ctx, userID, code)
	if err != nil {
		t.Fatalf("confirm MFA: %v", err)
	}

	login, err := service.Login(ctx, "alice", password, "", "")
	if err != nil {
		t.Fatalf("MFA login: %v", err)
	}
	if !login.MFARequired {
		t.Fatal("MFA login returned a full session")
	}
	if login.Token != "" || login.ChallengeToken == "" {
		t.Fatalf("login result = %+v", login)
	}

	code, err = totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("generate login code: %v", err)
	}

	session, err := service.CompleteMFA(ctx, login.ChallengeToken, code, "", "")
	if err != nil {
		t.Fatalf("complete MFA: %v", err)
	}
	if session.Token == "" {
		t.Fatal("MFA completion returned empty session token")
	}

	if _, err := service.Authenticate(ctx, session.Token); err != nil {
		t.Fatalf("authenticate MFA session: %v", err)
	}

	if _, err := service.CompleteMFA(ctx, login.ChallengeToken, code, "", ""); !errors.Is(err, ErrInvalidMFA) {
		t.Fatalf("reused challenge = %v", err)
	}

	recoveryLogin, err := service.Login(ctx, "alice", password, "", "")
	if err != nil {
		t.Fatalf("recovery login: %v", err)
	}

	recoveryCode := confirmation.RecoveryCodes[0]
	if _, err := service.CompleteMFA(ctx, recoveryLogin.ChallengeToken, recoveryCode, "", ""); err != nil {
		t.Fatalf("recovery authentication: %v", err)
	}

	reuseLogin, err := service.Login(ctx, "alice", password, "", "")
	if err != nil {
		t.Fatalf("recovery reuse login: %v", err)
	}

	if _, err := service.CompleteMFA(ctx, reuseLogin.ChallengeToken, recoveryCode, "", ""); !errors.Is(err, ErrInvalidMFA) {
		t.Fatalf("reused recovery code = %v", err)
	}
}
