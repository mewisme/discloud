package collections

import "testing"

func TestSharedWithUserIntegration(t *testing.T) {
	ctx, pool := openCollectionTestPool(t)
	ownerID, _ := createCollectionUser(t, ctx, pool, "shared-collection-owner")
	viewerID, _ := createCollectionUser(t, ctx, pool, "shared-collection-viewer")

	service := New(pool)
	owner := Actor{UserID: ownerID}

	collection, err := service.Create(ctx, owner, "Design", "Shared design files")
	if err != nil {
		t.Fatalf("create collection: %v", err)
	}
	if _, err := service.SetGrant(ctx, owner, collection.ID, viewerID, Edit); err != nil {
		t.Fatalf("grant collection: %v", err)
	}

	items, err := service.SharedWithUser(ctx, viewerID)
	if err != nil {
		t.Fatalf("list shared collections: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("shared collections = %d, want 1", len(items))
	}

	item := items[0]
	if item.ID != collection.ID || item.Level != Edit || item.OwnerUsername != "shared-collection-owner" {
		t.Fatalf("shared collection = %+v", item)
	}

	if err := service.Trash(ctx, owner, collection.ID); err != nil {
		t.Fatalf("trash collection: %v", err)
	}

	items, err = service.SharedWithUser(ctx, viewerID)
	if err != nil {
		t.Fatalf("list after trash: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("shared collections after trash = %d, want 0", len(items))
	}
}
