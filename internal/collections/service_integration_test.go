package collections

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

func TestCollectionACLAndMembershipIntegration(t *testing.T) {
	ctx, pool := openCollectionTestPool(t)

	ownerID, rootID := createCollectionUser(t, ctx, pool, "collection-owner")
	viewerID, _ := createCollectionUser(t, ctx, pool, "collection-viewer")
	editorID, _ := createCollectionUser(t, ctx, pool, "collection-editor")
	managerID, _ := createCollectionUser(t, ctx, pool, "collection-manager")

	file1 := createCollectionFile(t, ctx, pool, ownerID, rootID, "one.bin", 10)
	file2 := createCollectionFile(t, ctx, pool, ownerID, rootID, "two.bin", 20)

	service := New(pool)
	owner := Actor{UserID: ownerID}

	collection, err := service.Create(ctx, owner, "Release", "Release files")
	if err != nil {
		t.Fatalf("create collection: %v", err)
	}

	if _, err := service.SetGrant(ctx, owner, collection.ID, viewerID, View); err != nil {
		t.Fatalf("grant viewer: %v", err)
	}
	if _, err := service.SetGrant(ctx, owner, collection.ID, editorID, Edit); err != nil {
		t.Fatalf("grant editor: %v", err)
	}
	if _, err := service.SetGrant(ctx, owner, collection.ID, managerID, Full); err != nil {
		t.Fatalf("grant manager: %v", err)
	}

	created, err := service.AddItem(ctx, owner, collection.ID, file1)
	if err != nil || !created {
		t.Fatalf("add first item = %v, created=%v", err, created)
	}

	viewer := Actor{UserID: viewerID}
	items, err := service.ListItems(ctx, viewer, collection.ID)
	if err != nil {
		t.Fatalf("viewer list items: %v", err)
	}
	if len(items) != 1 || items[0].FileID != file1 {
		t.Fatalf("items = %+v", items)
	}

	level, err := acl.New(pool).Resolve(ctx, file1, viewerID, false)
	if err != nil {
		t.Fatalf("resolve folder ACL: %v", err)
	}
	if level != acl.None {
		t.Fatalf("viewer folder level = %s, want none", level.String())
	}

	_, err = service.AddItem(ctx, viewer, collection.ID, file2)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer add = %v", err)
	}

	editor := Actor{UserID: editorID}
	_, err = service.AddItem(ctx, editor, collection.ID, file2)
	if !errors.Is(err, ErrFileNotFound) {
		t.Fatalf("editor reference private file = %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO folder_permissions (folder_id, user_id, level, created_by)
		VALUES ($1::uuid, $2::uuid, 'view', $3::uuid)
	`, rootID, editorID, ownerID); err != nil {
		t.Fatalf("grant folder view: %v", err)
	}

	created, err = service.AddItem(ctx, editor, collection.ID, file2)
	if err != nil || !created {
		t.Fatalf("editor add item = %v, created=%v", err, created)
	}

	updatedName := "Release 2026"
	collection, err = service.Update(ctx, editor, collection.ID, UpdateInput{Name: &updatedName})
	if err != nil {
		t.Fatalf("editor update: %v", err)
	}
	if collection.Name != updatedName {
		t.Fatalf("name = %q, want %q", collection.Name, updatedName)
	}

	manager := Actor{UserID: managerID}
	if _, err := service.SetGrant(ctx, manager, collection.ID, viewerID, Edit); err != nil {
		t.Fatalf("manager update grant: %v", err)
	}

	if _, err := service.SetGrant(ctx, owner, collection.ID, ownerID, Full); !errors.Is(err, ErrOwnerGrant) {
		t.Fatalf("owner grant = %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE nodes SET deleted_at = now(), deleted_by = $2::uuid
		WHERE id = $1::uuid
	`, file1, ownerID); err != nil {
		t.Fatalf("trash file: %v", err)
	}

	items, err = service.ListItems(ctx, viewer, collection.ID)
	if err != nil {
		t.Fatalf("list after file trash: %v", err)
	}
	if len(items) != 1 || items[0].FileID != file2 {
		t.Fatalf("items after trash = %+v", items)
	}

	var membership int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM collection_items
		WHERE collection_id = $1::uuid
	`, collection.ID).Scan(&membership); err != nil {
		t.Fatalf("count membership: %v", err)
	}
	if membership != 2 {
		t.Fatalf("membership = %d, want 2", membership)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE nodes SET deleted_at = NULL, deleted_by = NULL
		WHERE id = $1::uuid
	`, file1); err != nil {
		t.Fatalf("restore file: %v", err)
	}

	items, err = service.ListItems(ctx, viewer, collection.ID)
	if err != nil {
		t.Fatalf("list after file restore: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("items after restore = %d, want 2", len(items))
	}

	if err := service.Trash(ctx, editor, collection.ID); err != nil {
		t.Fatalf("trash collection: %v", err)
	}
	if _, err := service.Get(ctx, viewer, collection.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get trashed collection = %v", err)
	}

	collection, err = service.Restore(ctx, editor, collection.ID, "")
	if err != nil {
		t.Fatalf("restore collection: %v", err)
	}

	items, err = service.ListItems(ctx, viewer, collection.ID)
	if err != nil {
		t.Fatalf("list restored collection: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("restored membership = %d, want 2", len(items))
	}
}

func TestCollectionRestoreNameConflict(t *testing.T) {
	ctx, pool := openCollectionTestPool(t)
	userID, _ := createCollectionUser(t, ctx, pool, "collection-conflict")
	service := New(pool)
	actor := Actor{UserID: userID}

	first, err := service.Create(ctx, actor, "Photos", "")
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	if err := service.Trash(ctx, actor, first.ID); err != nil {
		t.Fatalf("trash first: %v", err)
	}

	if _, err := service.Create(ctx, actor, "Photos", ""); err != nil {
		t.Fatalf("create replacement: %v", err)
	}

	if _, err := service.Restore(ctx, actor, first.ID, ""); !errors.Is(err, ErrNameConflict) {
		t.Fatalf("restore conflict = %v", err)
	}

	restored, err := service.Restore(ctx, actor, first.ID, "Old Photos")
	if err != nil {
		t.Fatalf("restore renamed: %v", err)
	}
	if restored.Name != "Old Photos" {
		t.Fatalf("name = %q", restored.Name)
	}
}

func openCollectionTestPool(t *testing.T) (context.Context, *pgxpool.Pool) {
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

	schema := fmt.Sprintf("discloud_collection_test_%d", time.Now().UnixNano())
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

func createCollectionUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string) (string, string) {
	t.Helper()

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash)
		VALUES ($1, 'test-hash')
		RETURNING id::text
	`, username).Scan(&userID); err != nil {
		t.Fatalf("create user %s: %v", username, err)
	}

	var rootID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (kind, owner_user_id, name, name_key, is_root, created_by)
		VALUES ('folder', $1::uuid, '', '', true, $1::uuid)
		RETURNING id::text
	`, userID).Scan(&rootID); err != nil {
		t.Fatalf("create root: %v", err)
	}
	return userID, rootID
}

func createCollectionFile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID, parentID, name string, size int64) string {
	t.Helper()

	var fileID string
	if err := pool.QueryRow(ctx, `
		WITH node AS (
			INSERT INTO nodes (kind, owner_user_id, parent_id, name, name_key, created_by)
			VALUES ('file', $1::uuid, $2::uuid, $3, lower($3), $1::uuid)
			RETURNING id
		)
		INSERT INTO files (node_id, size_bytes, chunk_size_bytes, mime_type)
		SELECT id, $4, 10, 'application/octet-stream'
		FROM node
		RETURNING node_id::text
	`, ownerID, parentID, name, size).Scan(&fileID); err != nil {
		t.Fatalf("create file %s: %v", name, err)
	}
	return fileID
}
