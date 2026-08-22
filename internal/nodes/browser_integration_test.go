package nodes

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestBrowserListingDoesNotCalculateFolderSizes(t *testing.T) {
	ctx, pool := openNodeConcurrencyTestPool(t)
	userID, rootID := createTreeUser(t, ctx, pool, "browser-size-owner", false)

	service := New(pool)
	actor := Actor{UserID: userID}

	largeFolder, err := service.CreateFolder(ctx, actor, rootID, "large-descendant")
	if err != nil {
		t.Fatalf("create large folder: %v", err)
	}

	nestedFolder, err := service.CreateFolder(ctx, actor, largeFolder.ID, "nested")
	if err != nil {
		t.Fatalf("create nested folder: %v", err)
	}

	emptyFolder, err := service.CreateFolder(ctx, actor, rootID, "empty-folder")
	if err != nil {
		t.Fatalf("create empty folder: %v", err)
	}

	createBrowserTestFile(t, ctx, pool, userID, nestedFolder.ID, "large.bin", 10_000)
	createBrowserTestFile(t, ctx, pool, userID, rootID, "small.bin", 10)
	createBrowserTestFile(t, ctx, pool, userID, rootID, "medium.bin", 20)

	items, hasMore, _, err := service.ListBrowserChildren(ctx, actor, rootID, BrowserListOptions{
		Limit: 10,
		Sort:  BrowserSortName,
		Order: BrowserOrderAsc,
	})
	if err != nil {
		t.Fatalf("list browser children: %v", err)
	}
	if hasMore {
		t.Fatal("unexpected additional browser page")
	}

	byName := make(map[string]BrowserNode, len(items))
	for _, item := range items {
		byName[item.Name] = item
	}

	for _, name := range []string{"empty-folder", "large-descendant"} {
		item, ok := byName[name]
		if !ok {
			t.Fatalf("folder %q is missing", name)
		}
		if item.SizeBytes != nil {
			t.Fatalf("folder %q size = %d, want nil", name, *item.SizeBytes)
		}
	}

	assertBrowserFileSize(t, byName, "small.bin", 10)
	assertBrowserFileSize(t, byName, "medium.bin", 20)

	firstPage, hasMore, _, err := service.ListBrowserChildren(ctx, actor, rootID, BrowserListOptions{
		Limit: 2,
		Sort:  BrowserSortSize,
		Order: BrowserOrderAsc,
	})
	if err != nil {
		t.Fatalf("list first size page: %v", err)
	}
	if !hasMore {
		t.Fatal("first size page should have more results")
	}
	if len(firstPage) != 2 {
		t.Fatalf("first size page length = %d, want 2", len(firstPage))
	}

	if firstPage[0].Name != emptyFolder.Name || firstPage[1].Name != largeFolder.Name {
		t.Fatalf(
			"first size page = [%s, %s], want [%s, %s]",
			firstPage[0].Name,
			firstPage[1].Name,
			emptyFolder.Name,
			largeFolder.Name,
		)
	}

	last := firstPage[len(firstPage)-1]
	secondPage, hasMore, _, err := service.ListBrowserChildren(ctx, actor, rootID, BrowserListOptions{
		Limit:        2,
		Sort:         BrowserSortSize,
		Order:        BrowserOrderAsc,
		AfterValue:   "0",
		AfterNameKey: last.NameKey,
		AfterID:      last.ID,
	})
	if err != nil {
		t.Fatalf("list second size page: %v", err)
	}
	if hasMore {
		t.Fatal("second size page unexpectedly has more results")
	}
	if len(secondPage) != 2 {
		t.Fatalf("second size page length = %d, want 2", len(secondPage))
	}
	if secondPage[0].Name != "small.bin" || secondPage[1].Name != "medium.bin" {
		t.Fatalf(
			"second size page = [%s, %s], want [small.bin, medium.bin]",
			secondPage[0].Name,
			secondPage[1].Name,
		)
	}
}

func createBrowserTestFile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID, parentID, name string, size int64) string {
	t.Helper()

	display, key, err := NormalizeName(name)
	if err != nil {
		t.Fatalf("normalize file name %q: %v", name, err)
	}

	var fileID string
	if err := pool.QueryRow(ctx, `
		WITH node AS (
			INSERT INTO nodes (
				kind,
				owner_user_id,
				parent_id,
				name,
				name_key,
				created_by
			)
			VALUES (
				'file',
				$1::uuid,
				$2::uuid,
				$3,
				$4,
				$1::uuid
			)
			RETURNING id
		)
		INSERT INTO files (
			node_id,
			size_bytes,
			chunk_size_bytes,
			mime_type,
			category,
			metadata_status
		)
		SELECT
			id,
			$5,
			10,
			'application/octet-stream',
			'binary',
			'ready'
		FROM node
		RETURNING node_id::text
	`, ownerID, parentID, display, key, size).Scan(&fileID); err != nil {
		t.Fatalf("create file %q: %v", name, err)
	}

	return fileID
}

func assertBrowserFileSize(t *testing.T, items map[string]BrowserNode, name string, want int64) {
	t.Helper()

	item, ok := items[name]
	if !ok {
		t.Fatalf("file %q is missing", name)
	}
	if item.SizeBytes == nil {
		t.Fatalf("file %q size is nil", name)
	}
	if *item.SizeBytes != want {
		t.Fatalf("file %q size = %d, want %d", name, *item.SizeBytes, want)
	}
}
