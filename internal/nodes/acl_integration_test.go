package nodes

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

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestNodeACLIntegration(t *testing.T) {
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

	schema := fmt.Sprintf("discloud_node_acl_test_%d", time.Now().UnixNano())
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

	ownerID, rootID := createTreeUser(t, ctx, pool, "acl-owner", false)
	viewerID, _ := createTreeUser(t, ctx, pool, "acl-viewer", false)
	editorID, _ := createTreeUser(t, ctx, pool, "acl-editor", false)
	outsiderID, _ := createTreeUser(t, ctx, pool, "acl-outsider", false)
	adminID, _ := createTreeUser(t, ctx, pool, "acl-admin", true)

	nodeService := New(pool)
	aclService := acl.New(pool)

	owner := Actor{UserID: ownerID}
	viewer := Actor{UserID: viewerID}
	editor := Actor{UserID: editorID}
	outsider := Actor{UserID: outsiderID}
	admin := Actor{UserID: adminID, Admin: true}

	shared, err := nodeService.CreateFolder(ctx, owner, rootID, "Shared")
	if err != nil {
		t.Fatalf("create shared folder: %v", err)
	}

	if _, err := aclService.Set(
		ctx,
		acl.Actor{UserID: ownerID},
		shared.ID,
		viewerID,
		acl.View,
	); err != nil {
		t.Fatalf("grant viewer: %v", err)
	}

	if _, err := aclService.Set(
		ctx,
		acl.Actor{UserID: ownerID},
		shared.ID,
		editorID,
		acl.Edit,
	); err != nil {
		t.Fatalf("grant editor: %v", err)
	}

	if _, err := nodeService.Get(ctx, viewer, shared.ID); err != nil {
		t.Fatalf("viewer get shared: %v", err)
	}

	if _, err := nodeService.Get(ctx, outsider, shared.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider get = %v", err)
	}

	if _, err := nodeService.CreateFolder(ctx, viewer, shared.ID, "Denied"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer create = %v", err)
	}

	child, err := nodeService.CreateFolder(ctx, editor, shared.ID, "Child")
	if err != nil {
		t.Fatalf("editor create: %v", err)
	}
	if child.OwnerID != ownerID {
		t.Fatalf("child owner = %s, want %s", child.OwnerID, ownerID)
	}

	children, _, err := nodeService.ListChildren(ctx, viewer, shared.ID, 50, "", "")
	if err != nil {
		t.Fatalf("viewer list: %v", err)
	}
	if len(children) != 1 || children[0].ID != child.ID {
		t.Fatalf("children = %+v", children)
	}

	renamed, err := nodeService.Rename(ctx, editor, child.ID, "Renamed")
	if err != nil {
		t.Fatalf("editor rename: %v", err)
	}
	if renamed.Name != "Renamed" {
		t.Fatalf("name = %q", renamed.Name)
	}

	breadcrumbs, err := nodeService.Breadcrumbs(ctx, viewer, child.ID)
	if err != nil {
		t.Fatalf("viewer breadcrumbs: %v", err)
	}
	if len(breadcrumbs) != 2 {
		t.Fatalf("breadcrumbs = %d, want 2", len(breadcrumbs))
	}
	if breadcrumbs[0].ID != shared.ID || breadcrumbs[1].ID != child.ID {
		t.Fatalf("breadcrumbs leaked inaccessible ancestors: %+v", breadcrumbs)
	}

	if _, err := nodeService.Get(ctx, admin, child.ID); err != nil {
		t.Fatalf("admin bypass: %v", err)
	}
}
