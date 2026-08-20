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

func TestAccountAndSessionsIntegration(t *testing.T) {
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

	schema := fmt.Sprintf("discloud_account_test_%d", time.Now().UnixNano())
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

	oldPassword := "correct-horse-battery-staple"
	newPassword := "another-correct-horse-password"

	hash, err := HashPassword(oldPassword)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (name, username, password_hash)
		VALUES ('Alice Example', 'alice', $1)
		RETURNING id::text
	`, hash).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	service := New(pool, time.Hour)

	first, err := service.Login(ctx, "alice", oldPassword, "", "")
	if err != nil {
		t.Fatalf("first login: %v", err)
	}

	second, err := service.Login(ctx, "alice", oldPassword, "", "")
	if err != nil {
		t.Fatalf("second login: %v", err)
	}

	current, err := service.Authenticate(ctx, first.Token)
	if err != nil {
		t.Fatalf("authenticate first session: %v", err)
	}

	sessions, err := service.ListSessions(ctx, userID, current.SessionID)
	if err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("sessions = %d, want 2", len(sessions))
	}

	user, err := service.UpdateName(ctx, userID, "  Alice Updated  ")
	if err != nil {
		t.Fatalf("update name: %v", err)
	}
	if user.Name != "Alice Updated" {
		t.Fatalf("name = %q, want %q", user.Name, "Alice Updated")
	}
	if user.Username != "alice" {
		t.Fatalf("username = %q, want alice", user.Username)
	}

	if err := service.ChangePassword(ctx, userID, current.SessionID, oldPassword, newPassword); err != nil {
		t.Fatalf("change password: %v", err)
	}

	if _, err := service.Authenticate(ctx, second.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("other session after password change = %v", err)
	}

	if _, err := service.Authenticate(ctx, first.Token); err != nil {
		t.Fatalf("current session after password change: %v", err)
	}

	if _, err := service.Login(ctx, "alice", oldPassword, "", ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("old password login = %v", err)
	}

	third, err := service.Login(ctx, "alice", newPassword, "", "")
	if err != nil {
		t.Fatalf("new password login: %v", err)
	}

	if err := service.RevokeOtherSessions(ctx, userID, current.SessionID); err != nil {
		t.Fatalf("revoke others: %v", err)
	}

	if _, err := service.Authenticate(ctx, third.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("other session after revoke = %v", err)
	}

	if err := service.RevokeSession(ctx, userID, current.SessionID); err != nil {
		t.Fatalf("revoke current session: %v", err)
	}

	if _, err := service.Authenticate(ctx, first.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("current session after revoke = %v", err)
	}
}
