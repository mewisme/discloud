package nodes

import (
	"context"
	"errors"
	"testing"
)

func TestSetFavoriteIntegration(t *testing.T) {
	ctx, pool := openBatchTestPool(t)
	ownerID, rootID := createTreeUser(t, ctx, pool, "favorite-owner", false)
	otherID, _ := createTreeUser(t, ctx, pool, "favorite-other", false)
	adminID, _ := createTreeUser(t, ctx, pool, "favorite-admin", true)
	service := New(pool)

	folder, err := service.CreateFolder(ctx, Actor{UserID: ownerID}, rootID, "Photos")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}

	node, err := service.SetFavorite(ctx, Actor{UserID: ownerID}, folder.ID, true)
	if err != nil {
		t.Fatalf("favorite: %v", err)
	}
	if !node.IsFavorite {
		t.Fatal("favorite flag was not set")
	}

	_, err = service.SetFavorite(ctx, Actor{UserID: otherID}, folder.ID, false)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("other user favorite = %v", err)
	}

	node, err = service.SetFavorite(ctx, Actor{UserID: adminID, Admin: true}, folder.ID, false)
	if err != nil {
		t.Fatalf("admin unfavorite: %v", err)
	}
	if node.IsFavorite {
		t.Fatal("favorite flag was not cleared")
	}

	var favorite bool
	if err := pool.QueryRow(context.Background(), `
		SELECT is_favorite
		FROM nodes
		WHERE id = $1::uuid
	`, folder.ID).Scan(&favorite); err != nil {
		t.Fatalf("read favorite: %v", err)
	}
	if favorite {
		t.Fatal("stored favorite = true, want false")
	}
}
