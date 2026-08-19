package shares

import (
	"errors"
	"testing"

	"github.com/mewisme/discloud/internal/collections"
)

func TestActiveShareIntegration(t *testing.T) {
	ctx, pool := openShareTestPool(t)
	ownerID, rootID := createShareUser(t, ctx, pool, "active-share-owner")
	viewerID, _ := createShareUser(t, ctx, pool, "active-share-viewer")
	fileID := createShareFile(t, ctx, pool, ownerID, rootID, "active.bin")

	service := New(pool, collections.New(pool))
	owner := Actor{UserID: ownerID}
	input := CreateInput{ResourceType: ResourceFile, ResourceID: fileID}

	if _, err := service.Active(ctx, owner, input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("active before create = %v", err)
	}

	created, err := service.Create(ctx, owner, input)
	if err != nil {
		t.Fatalf("create share: %v", err)
	}

	active, err := service.Active(ctx, owner, input)
	if err != nil {
		t.Fatalf("get active share: %v", err)
	}
	if active.ID != created.Share.ID || active.PublicID != created.Share.PublicID {
		t.Fatalf("active = %+v, created = %+v", active, created.Share)
	}

	if _, err := service.Active(ctx, Actor{UserID: viewerID}, input); !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer active lookup = %v", err)
	}

	if err := service.Revoke(ctx, owner, active.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := service.Active(ctx, owner, input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("active after revoke = %v", err)
	}
}
