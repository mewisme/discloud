package acl

import (
	"context"
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

func TestSharedWithUserIntegration(t *testing.T) {
	ctx, pool := openSharedACLTestPool(t)
	ownerID, rootID := createACLUser(t, ctx, pool, "shared-owner", "user")
	guestID, _ := createACLUser(t, ctx, pool, "shared-guest", "user")

	parentID := createACLFolder(t, ctx, pool, ownerID, rootID, "Parent")
	childID := createACLFolder(t, ctx, pool, ownerID, parentID, "Child")

	service := New(pool)
	owner := Actor{UserID: ownerID}

	if _, err := service.Set(ctx, owner, parentID, guestID, View); err != nil {
		t.Fatalf("grant parent: %v", err)
	}
	if _, err := service.Set(ctx, owner, childID, guestID, Edit); err != nil {
		t.Fatalf("grant child: %v", err)
	}

	items, err := service.SharedWithUser(ctx, guestID)
	if err != nil {
		t.Fatalf("list shared folders: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("shared folders = %d, want 2", len(items))
	}

	got := make(map[string]Level, len(items))
	for _, item := range items {
		got[item.ID] = item.Level
		if item.OwnerUsername != "shared-owner" {
			t.Fatalf("owner username = %q", item.OwnerUsername)
		}
	}
	if got[parentID] != View || got[childID] != Edit {
		t.Fatalf("levels = %+v", got)
	}

	if _, err := pool.Exec(ctx, "UPDATE nodes SET deleted_at = now() WHERE id = $1::uuid", parentID); err != nil {
		t.Fatalf("trash parent: %v", err)
	}

	items, err = service.SharedWithUser(ctx, guestID)
	if err != nil {
		t.Fatalf("list after trash: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("shared folders after ancestor trash = %d, want 0", len(items))
	}
}

func openSharedACLTestPool(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()

	dsn := os.Getenv("DISCLOUD_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("DISCLOUD_TEST_DATABASE_DSN is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		cancel()
		t.Fatalf("open admin pool: %v", err)
	}

	schema := fmt.Sprintf("discloud_shared_acl_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		admin.Close()
		cancel()
		t.Fatalf("create schema: %v", err)
	}

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse DSN: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("open isolated pool: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := migrate.Up(ctx, pool, migrations.FS, logger); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = admin.Exec(cleanupCtx, "DROP SCHEMA "+identifier+" CASCADE")
		admin.Close()
		cancel()
	})

	return ctx, pool
}
