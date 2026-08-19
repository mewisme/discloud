package nodes

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestTrashRestoreIntegration(t *testing.T) {
	ctx, pool := openBatchTestPool(t)
	userID, rootID := createTreeUser(t, ctx, pool, "trash-owner", false)
	service := New(pool)
	actor := Actor{UserID: userID}

	b, err := service.CreateFolder(ctx, actor, rootID, "B")
	if err != nil {
		t.Fatalf("create B: %v", err)
	}
	c, err := service.CreateFolder(ctx, actor, b.ID, "C")
	if err != nil {
		t.Fatalf("create C: %v", err)
	}

	file1 := createTrashFile(t, ctx, pool, userID, b.ID, "one.bin", 30)
	file2 := createTrashFile(t, ctx, pool, userID, c.ID, "two.bin", 10)
	outside := createTrashFile(t, ctx, pool, userID, rootID, "outside.bin", 20)
	_ = outside

	setTrashUsed(t, ctx, pool, userID, 60)
	assertTrashUsed(t, ctx, pool, userID, 60)

	if err := service.Trash(ctx, actor, c.ID); err != nil {
		t.Fatalf("trash C: %v", err)
	}
	assertTrashUsed(t, ctx, pool, userID, 50)

	if err := service.Trash(ctx, actor, b.ID); err != nil {
		t.Fatalf("trash B: %v", err)
	}
	assertTrashUsed(t, ctx, pool, userID, 20)

	if _, err := service.Get(ctx, actor, file1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("file under trashed B = %v", err)
	}

	var fileDeleted bool
	if err := pool.QueryRow(ctx, `
		SELECT deleted_at IS NOT NULL
		FROM nodes
		WHERE id = $1::uuid
	`, file1).Scan(&fileDeleted); err != nil {
		t.Fatalf("read file deletion state: %v", err)
	}
	if fileDeleted {
		t.Fatal("folder trash rewrote descendant deleted_at")
	}

	restoredB, err := service.Restore(ctx, actor, b.ID, RestoreInput{})
	if err != nil {
		t.Fatalf("restore B: %v", err)
	}
	if restoredB.ID != b.ID {
		t.Fatalf("restored ID = %s, want %s", restoredB.ID, b.ID)
	}
	assertTrashUsed(t, ctx, pool, userID, 50)

	if _, err := service.Get(ctx, actor, file1); err != nil {
		t.Fatalf("file1 should be active: %v", err)
	}
	if _, err := service.Get(ctx, actor, file2); !errors.Is(err, ErrNotFound) {
		t.Fatalf("nested deleted file = %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE users
		SET storage_quota_bytes = 55
		WHERE id = $1::uuid
	`, userID); err != nil {
		t.Fatalf("set quota: %v", err)
	}

	if _, err := service.Restore(ctx, actor, c.ID, RestoreInput{}); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("restore over quota = %v", err)
	}
	assertTrashUsed(t, ctx, pool, userID, 50)

	var cDeleted bool
	if err := pool.QueryRow(ctx, `
		SELECT deleted_at IS NOT NULL
		FROM nodes
		WHERE id = $1::uuid
	`, c.ID).Scan(&cDeleted); err != nil {
		t.Fatalf("read C state: %v", err)
	}
	if !cDeleted {
		t.Fatal("quota failure restored C")
	}

	if _, err := pool.Exec(ctx, `
		UPDATE users
		SET storage_quota_bytes = 100
		WHERE id = $1::uuid
	`, userID); err != nil {
		t.Fatalf("raise quota: %v", err)
	}

	if _, err := service.Restore(ctx, actor, c.ID, RestoreInput{}); err != nil {
		t.Fatalf("restore C: %v", err)
	}
	assertTrashUsed(t, ctx, pool, userID, 60)
}

func TestRestoreNameConflictAndDestination(t *testing.T) {
	ctx, pool := openBatchTestPool(t)
	userID, rootID := createTreeUser(t, ctx, pool, "restore-owner", false)
	service := New(pool)
	actor := Actor{UserID: userID}

	source, err := service.CreateFolder(ctx, actor, rootID, "Source")
	if err != nil {
		t.Fatalf("create source: %v", err)
	}
	destination, err := service.CreateFolder(ctx, actor, rootID, "Destination")
	if err != nil {
		t.Fatalf("create destination: %v", err)
	}

	fileID := createTrashFile(t, ctx, pool, userID, source.ID, "report.pdf", 10)
	setTrashUsed(t, ctx, pool, userID, 10)

	if err := service.Trash(ctx, actor, fileID); err != nil {
		t.Fatalf("trash file: %v", err)
	}
	assertTrashUsed(t, ctx, pool, userID, 0)

	createTrashFile(t, ctx, pool, userID, source.ID, "report.pdf", 1)
	setTrashUsed(t, ctx, pool, userID, 1)

	if _, err := service.Restore(ctx, actor, fileID, RestoreInput{}); !errors.Is(err, ErrNameConflict) {
		t.Fatalf("restore conflict = %v", err)
	}

	restored, err := service.Restore(ctx, actor, fileID, RestoreInput{
		ParentID: destination.ID,
		Name:     "restored.pdf",
	})
	if err != nil {
		t.Fatalf("restore to destination: %v", err)
	}
	if restored.ParentID != destination.ID || restored.Name != "restored.pdf" {
		t.Fatalf("restored = %+v", restored)
	}
	assertTrashUsed(t, ctx, pool, userID, 11)
}

func createTrashFile(t *testing.T, ctx context.Context, pool interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, ownerID, parentID, name string, size int64) string {
	t.Helper()

	display, key, err := NormalizeName(name)
	if err != nil {
		t.Fatalf("normalize %s: %v", name, err)
	}

	var id string
	if err := pool.QueryRow(ctx, `
		WITH node AS (
			INSERT INTO nodes (kind, owner_user_id, parent_id, name, name_key, created_by)
			VALUES ('file', $1::uuid, $2::uuid, $3, $4, $1::uuid)
			RETURNING id
		)
		INSERT INTO files (node_id, size_bytes, chunk_size_bytes, mime_type)
		SELECT id, $5, 10, 'application/octet-stream'
		FROM node
		RETURNING node_id::text
	`, ownerID, parentID, display, key, size).Scan(&id); err != nil {
		t.Fatalf("create file %s: %v", name, err)
	}
	return id
}

func setTrashUsed(t *testing.T, ctx context.Context, pool interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, userID string, used int64) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		UPDATE users
		SET storage_used_bytes = $2
		WHERE id = $1::uuid
	`, userID, used); err != nil {
		t.Fatalf("set used bytes: %v", err)
	}
}

func assertTrashUsed(t *testing.T, ctx context.Context, pool interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, userID string, want int64) {
	t.Helper()

	var got int64
	if err := pool.QueryRow(ctx, `
		SELECT storage_used_bytes
		FROM users
		WHERE id = $1::uuid
	`, userID).Scan(&got); err != nil {
		t.Fatalf("read used bytes: %v", err)
	}
	if got != want {
		t.Fatalf("used bytes = %d, want %d", got, want)
	}
}
