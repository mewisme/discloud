package search

import (
	"testing"

	"github.com/mewisme/discloud/internal/collections"
)

func TestSearchAccessTraversalRequiresActiveAncestorPaths(t *testing.T) {
	ctx, pool := openSearchTestPool(t)

	ownerID, rootID := createSearchUser(t, ctx, pool, "search-access-owner", false)
	viewerID, viewerRootID := createSearchUser(t, ctx, pool, "search-access-viewer", false)
	otherID, otherRootID := createSearchUser(t, ctx, pool, "search-access-other", false)

	sharedParentID := createSearchFolder(t, ctx, pool, ownerID, rootID, "Shared parent")
	sharedChildID := createSearchFolder(t, ctx, pool, ownerID, sharedParentID, "Shared child")
	sharedFileID := createSearchFile(t, ctx, pool, ownerID, sharedChildID, "shared-report.txt", 10)

	collectionParentID := createSearchFolder(t, ctx, pool, ownerID, rootID, "Collection parent")
	collectionFileID := createSearchFile(t, ctx, pool, ownerID, collectionParentID, "collection-only.txt", 20)

	viewerPrivateID := createSearchFile(t, ctx, pool, viewerID, viewerRootID, "viewer-private.txt", 30)
	irrelevantID := createSearchFile(t, ctx, pool, otherID, otherRootID, "irrelevant.txt", 40)

	if _, err := pool.Exec(ctx, `
		INSERT INTO folder_permissions (
			folder_id,
			user_id,
			level,
			created_by
		)
		VALUES ($1::uuid, $2::uuid, 'view', $3::uuid)
	`, sharedParentID, viewerID, ownerID); err != nil {
		t.Fatalf("grant shared folder: %v", err)
	}

	collectionService := collections.New(pool)
	collection, err := collectionService.Create(
		ctx,
		collections.Actor{UserID: ownerID},
		"Shared collection",
		"",
	)
	if err != nil {
		t.Fatalf("create collection: %v", err)
	}

	if _, err := collectionService.AddItem(
		ctx,
		collections.Actor{UserID: ownerID},
		collection.ID,
		collectionFileID,
	); err != nil {
		t.Fatalf("add collection file: %v", err)
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

	service := New(pool)
	viewer := Actor{UserID: viewerID}

	page, err := service.Search(ctx, viewer, Input{
		Sort:  SortName,
		Order: OrderAsc,
		Limit: 50,
	})
	if err != nil {
		t.Fatalf("search visible nodes: %v", err)
	}

	sharedFile, ok := findSearchItem(page.Items, sharedFileID)
	if !ok {
		t.Fatal("shared file is missing")
	}
	if !sharedFile.StructuralAccess {
		t.Fatal("shared file should have structural access")
	}
	if !sharedFile.Shared {
		t.Fatal("shared file should be marked shared")
	}

	collectionFile, ok := findSearchItem(page.Items, collectionFileID)
	if !ok {
		t.Fatal("collection-only file is missing")
	}
	if collectionFile.StructuralAccess {
		t.Fatal("collection-only file unexpectedly has structural access")
	}
	if collectionFile.AccessCollectionID == "" {
		t.Fatal("collection-only file has no collection access context")
	}
	if !collectionFile.Shared {
		t.Fatal("collection-only file should be marked shared")
	}

	if !containsSearchID(page.Items, viewerPrivateID) {
		t.Fatal("viewer private file is missing")
	}
	if containsSearchID(page.Items, irrelevantID) {
		t.Fatal("unrelated owner file leaked into search")
	}

	shared := true
	sharedPage, err := service.Search(ctx, viewer, Input{
		Shared: &shared,
		Sort:   SortName,
		Order:  OrderAsc,
		Limit:  50,
	})
	if err != nil {
		t.Fatalf("search shared nodes: %v", err)
	}
	if !containsSearchID(sharedPage.Items, sharedFileID) {
		t.Fatal("shared structural file missing from shared filter")
	}
	if !containsSearchID(sharedPage.Items, collectionFileID) {
		t.Fatal("shared collection file missing from shared filter")
	}
	if containsSearchID(sharedPage.Items, viewerPrivateID) {
		t.Fatal("private viewer file matched shared filter")
	}

	if _, err := pool.Exec(ctx, `
		UPDATE nodes
		SET deleted_at = now(),
		    deleted_by = $3::uuid
		WHERE id IN ($1::uuid, $2::uuid)
	`, sharedParentID, collectionParentID, ownerID); err != nil {
		t.Fatalf("trash access ancestors: %v", err)
	}

	page, err = service.Search(ctx, viewer, Input{
		Sort:  SortName,
		Order: OrderAsc,
		Limit: 50,
	})
	if err != nil {
		t.Fatalf("search after ancestor trash: %v", err)
	}

	if containsSearchID(page.Items, sharedFileID) {
		t.Fatal("shared descendant remained visible below trashed ancestor")
	}
	if containsSearchID(page.Items, collectionFileID) {
		t.Fatal("collection-only descendant remained visible below trashed ancestor")
	}
	if !containsSearchID(page.Items, viewerPrivateID) {
		t.Fatal("viewer private file disappeared after unrelated trash")
	}
}
