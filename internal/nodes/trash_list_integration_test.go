package nodes

import (
	"context"
	"errors"
	"testing"
)

func TestListTrashRootsIntegration(t *testing.T) {
	ctx, pool := openBatchTestPool(t)
	userID, rootID := createTreeUser(t, ctx, pool, "trash-list-owner", false)
	otherID, _ := createTreeUser(t, ctx, pool, "trash-list-other", false)
	adminID, _ := createTreeUser(t, ctx, pool, "trash-list-admin", true)

	service := New(pool)
	actor := Actor{UserID: userID}

	a, err := service.CreateFolder(ctx, actor, rootID, "A")
	if err != nil {
		t.Fatalf("create A: %v", err)
	}
	b, err := service.CreateFolder(ctx, actor, a.ID, "B")
	if err != nil {
		t.Fatalf("create B: %v", err)
	}

	createTrashFile(t, ctx, pool, userID, b.ID, "nested.bin", 10)
	setTrashUsed(t, ctx, pool, userID, 10)

	if err := service.Trash(ctx, actor, b.ID); err != nil {
		t.Fatalf("trash B: %v", err)
	}
	if err := service.Trash(ctx, actor, a.ID); err != nil {
		t.Fatalf("trash A: %v", err)
	}

	items, hasMore, err := service.ListTrash(ctx, actor, "", 50, nil, "")
	if err != nil {
		t.Fatalf("list trash: %v", err)
	}
	if hasMore || len(items) != 1 || items[0].ID != a.ID {
		t.Fatalf("trash = %+v, hasMore=%v", items, hasMore)
	}

	if _, err := service.Restore(ctx, actor, a.ID, RestoreInput{}); err != nil {
		t.Fatalf("restore A: %v", err)
	}

	items, _, err = service.ListTrash(ctx, actor, "", 50, nil, "")
	if err != nil {
		t.Fatalf("list trash after restore: %v", err)
	}
	if len(items) != 1 || items[0].ID != b.ID {
		t.Fatalf("trash after restore = %+v", items)
	}

	_, _, err = service.ListTrash(ctx, Actor{UserID: otherID}, userID, 50, nil, "")
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("cross-owner trash listing = %v", err)
	}

	items, _, err = service.ListTrash(ctx, Actor{UserID: adminID, Admin: true}, userID, 50, nil, "")
	if err != nil {
		t.Fatalf("admin trash listing: %v", err)
	}
	if len(items) != 1 || items[0].ID != b.ID {
		t.Fatalf("admin trash = %+v", items)
	}
}

func TestListTrashCursorIntegration(t *testing.T) {
	ctx, pool := openBatchTestPool(t)
	userID, rootID := createTreeUser(t, ctx, pool, "trash-cursor-owner", false)
	service := New(pool)
	actor := Actor{UserID: userID}

	for _, name := range []string{"A", "B", "C"} {
		node, err := service.CreateFolder(ctx, actor, rootID, name)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		if err := service.Trash(ctx, actor, node.ID); err != nil {
			t.Fatalf("trash %s: %v", name, err)
		}
	}

	first, hasMore, err := service.ListTrash(ctx, actor, "", 2, nil, "")
	if err != nil {
		t.Fatalf("first page: %v", err)
	}
	if len(first) != 2 || !hasMore {
		t.Fatalf("first page = %d, hasMore=%v", len(first), hasMore)
	}

	last := first[len(first)-1]
	second, hasMore, err := service.ListTrash(ctx, actor, "", 2, &last.DeletedAt, last.ID)
	if err != nil {
		t.Fatalf("second page: %v", err)
	}
	if len(second) != 1 || hasMore {
		t.Fatalf("second page = %d, hasMore=%v", len(second), hasMore)
	}
}

func TestRestoreRequiresOriginalAuthority(t *testing.T) {
	ctx, pool := openBatchTestPool(t)
	ownerID, rootID := createTreeUser(t, ctx, pool, "restore-private-owner", false)
	otherID, _ := createTreeUser(t, ctx, pool, "restore-private-other", false)
	service := New(pool)
	owner := Actor{UserID: ownerID}

	private, err := service.CreateFolder(ctx, owner, rootID, "Private")
	if err != nil {
		t.Fatalf("create private: %v", err)
	}
	shared, err := service.CreateFolder(ctx, owner, rootID, "Shared")
	if err != nil {
		t.Fatalf("create shared: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO folder_permissions (folder_id, user_id, level, created_by)
		VALUES ($1::uuid, $2::uuid, 'edit', $3::uuid)
	`, shared.ID, otherID, ownerID); err != nil {
		t.Fatalf("grant shared edit: %v", err)
	}

	fileID := createTrashFile(t, ctx, pool, ownerID, private.ID, "secret.bin", 10)
	setTrashUsed(t, ctx, pool, ownerID, 10)

	if err := service.Trash(ctx, owner, fileID); err != nil {
		t.Fatalf("trash private file: %v", err)
	}

	_, err = service.Restore(ctx, Actor{UserID: otherID}, fileID, RestoreInput{ParentID: shared.ID})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized restore = %v", err)
	}

	var deleted bool
	if err := pool.QueryRow(ctx, `
		SELECT deleted_at IS NOT NULL
		FROM nodes
		WHERE id = $1::uuid
	`, fileID).Scan(&deleted); err != nil {
		t.Fatalf("read deletion state: %v", err)
	}
	if !deleted {
		t.Fatal("unauthorized restore changed file")
	}
}

var _ context.Context
