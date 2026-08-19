package search

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

	"github.com/mewisme/discloud/internal/collections"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestPermissionAwareSearchIntegration(t *testing.T) {
	ctx, pool := openSearchTestPool(t)
	ownerID, rootID := createSearchUser(t, ctx, pool, "search-owner", false)
	viewerID, _ := createSearchUser(t, ctx, pool, "search-viewer", false)

	sharedID := createSearchFolder(t, ctx, pool, ownerID, rootID, "Shared")
	privateID := createSearchFolder(t, ctx, pool, ownerID, rootID, "Private")
	reportID := createSearchFile(t, ctx, pool, ownerID, sharedID, "report-final.pdf", 20)
	collectionOnlyID := createSearchFile(t, ctx, pool, ownerID, privateID, "collection-note.txt", 10)
	secretID := createSearchFile(t, ctx, pool, ownerID, privateID, "secret.bin", 30)

	if _, err := pool.Exec(ctx, `
		INSERT INTO folder_permissions (folder_id, user_id, level, created_by)
		VALUES ($1::uuid, $2::uuid, 'view', $3::uuid)
	`, sharedID, viewerID, ownerID); err != nil {
		t.Fatalf("grant folder: %v", err)
	}

	collectionService := collections.New(pool)
	collection, err := collectionService.Create(
		ctx,
		collections.Actor{UserID: ownerID},
		"Notes",
		"",
	)
	if err != nil {
		t.Fatalf("create collection: %v", err)
	}
	if _, err := collectionService.AddItem(
		ctx,
		collections.Actor{UserID: ownerID},
		collection.ID,
		collectionOnlyID,
	); err != nil {
		t.Fatalf("add collection item: %v", err)
	}
	if _, err := collectionService.SetGrant(
		ctx,
		collections.Actor{UserID: ownerID},
		collection.ID,
		viewerID,
		collections.View,
	); err != nil {
		t.Fatalf("grant collection: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE nodes
		SET is_favorite = true
		WHERE id = $1::uuid
	`, reportID); err != nil {
		t.Fatalf("favorite report: %v", err)
	}

	service := New(pool)
	viewer := Actor{UserID: viewerID}

	page, err := service.Search(ctx, viewer, Input{
		Query: "report",
		Limit: 50,
	})
	if err != nil {
		t.Fatalf("search report: %v", err)
	}
	if !containsSearchID(page.Items, reportID) {
		t.Fatalf("report missing: %+v", page.Items)
	}
	if containsSearchID(page.Items, secretID) {
		t.Fatal("private secret leaked")
	}

	page, err = service.Search(ctx, viewer, Input{
		Query: "collection",
		Limit: 50,
	})
	if err != nil {
		t.Fatalf("search collection item: %v", err)
	}

	item, ok := findSearchItem(page.Items, collectionOnlyID)
	if !ok {
		t.Fatalf("collection item missing: %+v", page.Items)
	}
	if item.StructuralAccess || item.ParentID != "" {
		t.Fatalf("collection-only item leaked parent: %+v", item)
	}
	if item.AccessCollectionID == "" {
		t.Fatal("collection-only item has no access context")
	}

	page, err = service.Search(ctx, viewer, Input{
		FolderID: privateID,
		Limit:    50,
	})
	if err != nil {
		t.Fatalf("private subtree filter: %v", err)
	}
	if len(page.Items) != 0 {
		t.Fatalf("private subtree leaked through collection: %+v", page.Items)
	}

	favorite := true
	page, err = service.Search(ctx, viewer, Input{
		Favorite: &favorite,
		Limit:    50,
	})
	if err != nil {
		t.Fatalf("favorite search: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != reportID {
		t.Fatalf("favorite results = %+v", page.Items)
	}
}

func TestSearchCursorAndAdminTrashIntegration(t *testing.T) {
	ctx, pool := openSearchTestPool(t)
	ownerID, rootID := createSearchUser(t, ctx, pool, "search-page-owner", false)
	adminID, _ := createSearchUser(t, ctx, pool, "search-page-admin", true)

	firstID := createSearchFile(t, ctx, pool, ownerID, rootID, "alpha.txt", 1)
	secondID := createSearchFile(t, ctx, pool, ownerID, rootID, "beta.txt", 2)
	thirdID := createSearchFile(t, ctx, pool, ownerID, rootID, "gamma.txt", 3)

	service := New(pool)
	owner := Actor{UserID: ownerID}

	first, err := service.Search(ctx, owner, Input{
		Sort:  SortName,
		Order: OrderAsc,
		Limit: 2,
	})
	if err != nil {
		t.Fatalf("first page: %v", err)
	}
	if len(first.Items) != 2 || !first.HasMore {
		t.Fatalf("first page = %+v", first)
	}

	last := first.Items[len(first.Items)-1]
	second, err := service.Search(ctx, owner, Input{
		Sort:     SortName,
		Order:    OrderAsc,
		Limit:    2,
		AfterKey: last.CursorKey,
		AfterID:  last.ID,
	})
	if err != nil {
		t.Fatalf("second page: %v", err)
	}
	if len(second.Items) != 1 || second.HasMore {
		t.Fatalf("second page = %+v", second)
	}

	seen := map[string]bool{}
	for _, item := range first.Items {
		seen[item.ID] = true
	}
	for _, item := range second.Items {
		seen[item.ID] = true
	}
	for _, id := range []string{firstID, secondID, thirdID} {
		if !seen[id] {
			t.Fatalf("missing paginated result %s", id)
		}
	}

	if _, err := pool.Exec(ctx, `
		UPDATE nodes
		SET deleted_at = now(), deleted_by = $2::uuid
		WHERE id = $1::uuid
	`, thirdID, ownerID); err != nil {
		t.Fatalf("trash gamma: %v", err)
	}

	page, err := service.Search(ctx, Actor{UserID: adminID, Admin: true}, Input{
		OwnerID: ownerID,
		State:   StateTrash,
		Limit:   50,
	})
	if err != nil {
		t.Fatalf("admin trash search: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != thirdID {
		t.Fatalf("admin trash = %+v", page.Items)
	}
}

func containsSearchID(items []Result, id string) bool {
	_, ok := findSearchItem(items, id)
	return ok
}

func findSearchItem(items []Result, id string) (Result, bool) {
	for _, item := range items {
		if item.ID == id {
			return item, true
		}
	}
	return Result{}, false
}

func openSearchTestPool(t *testing.T) (context.Context, *pgxpool.Pool) {
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

	schema := fmt.Sprintf("discloud_search_test_%d", time.Now().UnixNano())
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

func createSearchUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string, admin bool) (string, string) {
	t.Helper()

	role := "user"
	if admin {
		role = "admin"
	}

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, 'test-hash', $2)
		RETURNING id::text
	`, username, role).Scan(&userID); err != nil {
		t.Fatalf("create user %s: %v", username, err)
	}

	var rootID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (
			kind, owner_user_id, name, name_key, is_root, created_by
		)
		VALUES ('folder', $1::uuid, '', '', true, $1::uuid)
		RETURNING id::text
	`, userID).Scan(&rootID); err != nil {
		t.Fatalf("create root: %v", err)
	}

	return userID, rootID
}

func createSearchFolder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID, parentID, name string) string {
	t.Helper()

	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (
			kind, owner_user_id, parent_id, name, name_key, created_by
		)
		VALUES ('folder', $1::uuid, $2::uuid, $3, lower($3), $1::uuid)
		RETURNING id::text
	`, ownerID, parentID, name).Scan(&id); err != nil {
		t.Fatalf("create folder %s: %v", name, err)
	}
	return id
}

func createSearchFile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID, parentID, name string, size int64) string {
	t.Helper()

	var id string
	if err := pool.QueryRow(ctx, `
		WITH node AS (
			INSERT INTO nodes (
				kind, owner_user_id, parent_id, name, name_key, created_by
			)
			VALUES ('file', $1::uuid, $2::uuid, $3, lower($3), $1::uuid)
			RETURNING id
		)
		INSERT INTO files (
			node_id, size_bytes, chunk_size_bytes, mime_type, category
		)
		SELECT
			id, $4, 10, 'text/plain', 'text'
		FROM node
		RETURNING node_id::text
	`, ownerID, parentID, name, size).Scan(&id); err != nil {
		t.Fatalf("create file %s: %v", name, err)
	}
	return id
}
