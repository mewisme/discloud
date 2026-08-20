package collections

import (
	"errors"
	"testing"
)

func TestCollectionOwnerScopeIntegration(t *testing.T) {
	ctx, pool := openCollectionTestPool(t)

	ownerAID, _ := createCollectionUser(t, ctx, pool, "collection-owner-scope-a")
	ownerBID, _ := createCollectionUser(t, ctx, pool, "collection-owner-scope-b")
	adminID, _ := createCollectionUser(t, ctx, pool, "collection-owner-scope-admin")

	service := New(pool)
	ownerA := Actor{UserID: ownerAID}
	ownerB := Actor{UserID: ownerBID}
	admin := Actor{UserID: adminID, Admin: true}

	collectionA, err := service.Create(ctx, ownerA, "Owner A", "")
	if err != nil {
		t.Fatalf("create owner A collection: %v", err)
	}
	collectionB, err := service.Create(ctx, ownerB, "Owner B", "")
	if err != nil {
		t.Fatalf("create owner B collection: %v", err)
	}

	items, hasMore, err := service.ListForOwner(ctx, ownerA, ownerAID, 50, "", "")
	if err != nil {
		t.Fatalf("owner list self: %v", err)
	}
	if hasMore || len(items) != 1 || items[0].ID != collectionA.ID {
		t.Fatalf("owner self scope = %+v, hasMore=%v", items, hasMore)
	}

	if _, _, err := service.ListForOwner(ctx, ownerA, ownerBID, 50, "", ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("owner list other = %v", err)
	}

	items, hasMore, err = service.ListForOwner(ctx, admin, ownerBID, 50, "", "")
	if err != nil {
		t.Fatalf("admin list owner B: %v", err)
	}
	if hasMore || len(items) != 1 || items[0].ID != collectionB.ID {
		t.Fatalf("admin owner B scope = %+v, hasMore=%v", items, hasMore)
	}

	created, err := service.CreateForOwner(ctx, admin, ownerBID, "Admin-created", "")
	if err != nil {
		t.Fatalf("admin create for owner B: %v", err)
	}
	if created.OwnerID != ownerBID {
		t.Fatalf("created owner = %q, want %q", created.OwnerID, ownerBID)
	}

	if _, err := service.CreateForOwner(ctx, ownerA, ownerBID, "Not allowed", ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("owner create for other = %v", err)
	}

	if _, err := service.CreateForOwner(ctx, admin, "00000000-0000-7000-8000-000000000099", "Missing owner", ""); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("admin create for missing owner = %v", err)
	}
}
