package shares

import (
	"errors"
	"testing"

	"github.com/mewisme/discloud/internal/collections"
)

func TestPublicFolderScopeIntegration(t *testing.T) {
	ctx, pool := openShareTestPool(t)
	userID, rootID := createShareUser(t, ctx, pool, "public-folder-owner")
	service := New(pool, collections.New(pool))
	actor := Actor{UserID: userID}

	var sharedID, childID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (kind, owner_user_id, parent_id, name, name_key, created_by)
		VALUES ('folder', $1::uuid, $2::uuid, 'Shared', 'shared', $1::uuid)
		RETURNING id::text
	`, userID, rootID).Scan(&sharedID); err != nil {
		t.Fatalf("create shared folder: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (kind, owner_user_id, parent_id, name, name_key, created_by)
		VALUES ('folder', $1::uuid, $2::uuid, 'Child', 'child', $1::uuid)
		RETURNING id::text
	`, userID, sharedID).Scan(&childID); err != nil {
		t.Fatalf("create child folder: %v", err)
	}

	insideID := createShareFile(t, ctx, pool, userID, childID, "inside.bin")
	outsideID := createShareFile(t, ctx, pool, userID, rootID, "outside.bin")

	result, err := service.Create(ctx, actor, CreateInput{
		ResourceType: ResourceFolder,
		ResourceID:   sharedID,
	})
	if err != nil {
		t.Fatalf("create folder share: %v", err)
	}

	share, err := service.Resolve(ctx, result.Share.PublicID)
	if err != nil {
		t.Fatalf("resolve share: %v", err)
	}

	folder, err := service.Folder(ctx, share, sharedID)
	if err != nil {
		t.Fatalf("browse root: %v", err)
	}
	if folder.ID != sharedID || len(folder.Children) != 1 || folder.Children[0].ID != childID {
		t.Fatalf("public folder = %+v", folder)
	}

	if err := service.CanAccessFolder(ctx, share, childID); err != nil {
		t.Fatalf("child folder access: %v", err)
	}
	if err := service.CanAccessFile(ctx, share, insideID); err != nil {
		t.Fatalf("inside file access: %v", err)
	}
	if err := service.CanAccessFile(ctx, share, outsideID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outside file access = %v", err)
	}
	if err := service.CanAccessFolder(ctx, share, rootID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("parent folder access = %v", err)
	}
}

func TestPublicCollectionScopeIntegration(t *testing.T) {
	ctx, pool := openShareTestPool(t)
	userID, rootID := createShareUser(t, ctx, pool, "public-collection-owner")

	collectionService := collections.New(pool)
	service := New(pool, collectionService)
	owner := collections.Actor{UserID: userID}

	memberID := createShareFile(t, ctx, pool, userID, rootID, "member.bin")
	outsideID := createShareFile(t, ctx, pool, userID, rootID, "outside.bin")

	collection, err := collectionService.Create(ctx, owner, "Public", "")
	if err != nil {
		t.Fatalf("create collection: %v", err)
	}
	if _, err := collectionService.AddItem(ctx, owner, collection.ID, memberID); err != nil {
		t.Fatalf("add item: %v", err)
	}

	result, err := service.Create(ctx, Actor{UserID: userID}, CreateInput{
		ResourceType: ResourceCollection,
		ResourceID:   collection.ID,
	})
	if err != nil {
		t.Fatalf("share collection: %v", err)
	}

	share, err := service.Resolve(ctx, result.Share.PublicID)
	if err != nil {
		t.Fatalf("resolve share: %v", err)
	}

	items, err := service.CollectionItems(ctx, share)
	if err != nil {
		t.Fatalf("list public items: %v", err)
	}
	if len(items) != 1 || items[0].ID != memberID {
		t.Fatalf("items = %+v", items)
	}

	if err := service.CanAccessFile(ctx, share, memberID); err != nil {
		t.Fatalf("member access: %v", err)
	}
	if err := service.CanAccessFile(ctx, share, outsideID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outside access = %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE nodes
		SET deleted_at = now(), deleted_by = $2::uuid
		WHERE id = $1::uuid
	`, memberID, userID); err != nil {
		t.Fatalf("trash member: %v", err)
	}

	items, err = service.CollectionItems(ctx, share)
	if err != nil {
		t.Fatalf("list after trash: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("trashed items = %+v", items)
	}
}
