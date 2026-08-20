package adminusers

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

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestAdminUserLifecycleIntegration(t *testing.T) {
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

	schema := fmt.Sprintf("discloud_admin_users_test_%d", time.Now().UnixNano())
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

	adminHash, err := auth.HashPassword("admin-correct-horse-password")
	if err != nil {
		t.Fatalf("hash admin password: %v", err)
	}

	var adminID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ('admin', $1, 'admin')
		RETURNING id::text
	`, adminHash).Scan(&adminID); err != nil {
		t.Fatalf("create admin: %v", err)
	}

	service := New(pool)
	quota := int64(1024)

	user, err := service.Create(ctx, adminID, CreateInput{
		Name:              "Alice Example",
		Username:          "alice",
		Password:          "correct-horse-battery-staple",
		StorageQuotaBytes: &quota,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	if user.Role != "user" {
		t.Fatalf("role = %q, want user", user.Role)
	}
	if !user.MustChangePassword {
		t.Fatal("admin-created user should change password")
	}

	root, err := service.Root(ctx, user.ID)
	if err != nil {
		t.Fatalf("get root: %v", err)
	}
	if root.ID == "" {
		t.Fatal("root ID is empty")
	}

	usage, err := service.Usage(ctx, user.ID)
	if err != nil {
		t.Fatalf("get usage: %v", err)
	}
	if usage.QuotaBytes == nil || *usage.QuotaBytes != quota {
		t.Fatalf("quota = %v, want %d", usage.QuotaBytes, quota)
	}
	if usage.AvailableBytes == nil || *usage.AvailableBytes != quota {
		t.Fatalf("available = %v, want %d", usage.AvailableBytes, quota)
	}

	if _, err := service.Create(ctx, adminID, CreateInput{
		Name:     "Another Alice",
		Username: "Alice",
		Password: "another-correct-password",
	}); !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("duplicate username = %v", err)
	}

	updatedName := "Alice Updated"
	updated, err := service.Update(ctx, adminID, user.ID, UpdateInput{Name: &updatedName})
	if err != nil {
		t.Fatalf("update user: %v", err)
	}
	if updated.Name != "Alice Updated" {
		t.Fatalf("name = %q, want Alice Updated", updated.Name)
	}
	if updated.Username != "alice" {
		t.Fatalf("username = %q, want alice", updated.Username)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, decode('01', 'hex'), now() + interval '1 hour')
	`, user.ID); err != nil {
		t.Fatalf("create session: %v", err)
	}

	if err := service.Disable(ctx, adminID, user.ID); err != nil {
		t.Fatalf("disable user: %v", err)
	}

	var activeSessions int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM sessions
		WHERE user_id::text = $1
		  AND revoked_at IS NULL
	`, user.ID).Scan(&activeSessions); err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if activeSessions != 0 {
		t.Fatalf("active sessions = %d, want 0", activeSessions)
	}

	if err := service.Enable(ctx, adminID, user.ID); err != nil {
		t.Fatalf("enable user: %v", err)
	}

	if err := service.SetQuota(ctx, adminID, user.ID, nil); err != nil {
		t.Fatalf("set unlimited quota: %v", err)
	}

	usage, err = service.Usage(ctx, user.ID)
	if err != nil {
		t.Fatalf("get unlimited usage: %v", err)
	}
	if usage.QuotaBytes != nil || usage.AvailableBytes != nil {
		t.Fatalf("unlimited usage = %+v", usage)
	}

	if err := service.ResetPassword(ctx, adminID, user.ID, "new-correct-horse-password"); err != nil {
		t.Fatalf("reset password: %v", err)
	}

	var mustChange bool
	if err := pool.QueryRow(ctx, `
		SELECT must_change_password
		FROM users
		WHERE id::text = $1
	`, user.ID).Scan(&mustChange); err != nil {
		t.Fatalf("read must_change_password: %v", err)
	}
	if !mustChange {
		t.Fatal("must_change_password is false after admin reset")
	}

	var auditCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM audit_events
		WHERE actor_user_id::text = $1
		  AND resource_id::text = $2
	`, adminID, user.ID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit events: %v", err)
	}
	if auditCount < 5 {
		t.Fatalf("audit events = %d, want at least 5", auditCount)
	}
}
