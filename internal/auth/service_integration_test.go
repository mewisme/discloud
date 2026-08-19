package auth

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestSessionLifecycleIntegration(t *testing.T) {
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

	schema := fmt.Sprintf("discloud_auth_test_%d", time.Now().UnixNano())
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

	if err := migrate.Up(ctx, pool, migrations.FS, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	passwordHash, err := HashPassword("correct-horse-battery-staple")
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

	service := New(pool, time.Hour)

	login, err := service.Login(ctx, "Alice", "correct-horse-battery-staple", "integration-test", "127.0.0.1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if login.Token == "" || login.User.ID != userID {
		t.Fatalf("login result = %+v", login)
	}

	principal, err := service.Authenticate(ctx, login.Token)
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if principal.User.ID != userID {
		t.Fatalf("authenticated user = %s, want %s", principal.User.ID, userID)
	}

	if err := service.RevokeToken(ctx, login.Token); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	_, err = service.Authenticate(ctx, login.Token)
	if !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("authenticate after revoke = %v, want unauthenticated", err)
	}
}
