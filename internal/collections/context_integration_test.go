package collections

import (
	"errors"
	"testing"

	"github.com/mewisme/discloud/internal/acl"
)

func TestCollectionContextDoesNotGrantFolderAccess(t *testing.T) {
	ctx, pool := openCollectionTestPool(t)
	ownerID, rootID := createCollectionUser(t, ctx, pool, "context-owner")
	viewerID, _ := createCollectionUser(t, ctx, pool, "context-viewer")

	var folderID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (kind, owner_user_id, parent_id, name, name_key, created_by)
		VALUES ('folder', $1::uuid, $2::uuid, 'Private', 'private', $1::uuid)
		RETURNING id::text
	`, ownerID, rootID).Scan(&folderID); err != nil {
		t.Fatalf("create folder: %v", err)
	}

	fileID := createCollectionFile(t, ctx, pool, ownerID, folderID, "secret.bin", 10)
	service := New(pool)
	owner := Actor{UserID: ownerID}
	viewer := Actor{UserID: viewerID}

	collection, err := service.Create(ctx, owner, "Shared", "")
	if err != nil {
		t.Fatalf("create collection: %v", err)
	}
	if _, err := service.AddItem(ctx, owner, collection.ID, fileID); err != nil {
		t.Fatalf("add item: %v", err)
	}
	if _, err := service.SetGrant(ctx, owner, collection.ID, viewerID, View); err != nil {
		t.Fatalf("grant view: %v", err)
	}

	if err := service.CanViewItem(ctx, viewer, collection.ID, fileID); err != nil {
		t.Fatalf("collection item access: %v", err)
	}

	level, err := acl.New(pool).Resolve(ctx, fileID, viewerID, false)
	if err != nil {
		t.Fatalf("resolve folder ACL: %v", err)
	}
	if level != acl.None {
		t.Fatalf("folder ACL = %s, want none", level.String())
	}

	if _, err := pool.Exec(ctx, `
		UPDATE nodes
		SET deleted_at = now(), deleted_by = $2::uuid
		WHERE id = $1::uuid
	`, folderID, ownerID); err != nil {
		t.Fatalf("trash parent: %v", err)
	}

	if err := service.CanViewItem(ctx, viewer, collection.ID, fileID); !errors.Is(err, ErrFileNotFound) {
		t.Fatalf("effectively deleted item = %v", err)
	}

	var memberships int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM collection_items
		WHERE collection_id = $1::uuid
		  AND file_id = $2::uuid
	`, collection.ID, fileID).Scan(&memberships); err != nil {
		t.Fatalf("count membership: %v", err)
	}
	if memberships != 1 {
		t.Fatalf("membership = %d, want 1", memberships)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE nodes
		SET deleted_at = NULL, deleted_by = NULL
		WHERE id = $1::uuid
	`, folderID); err != nil {
		t.Fatalf("restore parent: %v", err)
	}

	if err := service.CanViewItem(ctx, viewer, collection.ID, fileID); err != nil {
		t.Fatalf("restored collection item: %v", err)
	}
}
