package nodes

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestPurgeRemovesDatabaseStateWithoutTouchingSharedChunks(t *testing.T) {
	ctx, pool := openBatchTestPool(t)
	userID, rootID := createTreeUser(t, ctx, pool, "purge-owner", false)
	service := New(pool)
	actor := Actor{UserID: userID}

	folder, err := service.CreateFolder(ctx, actor, rootID, "Delete me")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}
	nested, err := service.CreateFolder(ctx, actor, folder.ID, "Nested")
	if err != nil {
		t.Fatalf("create nested folder: %v", err)
	}

	fileID := createTrashFile(t, ctx, pool, userID, folder.ID, "shared.bin", 10)
	nestedFileID := createTrashFile(t, ctx, pool, userID, nested.ID, "unique.bin", 10)
	outsideFileID := createTrashFile(t, ctx, pool, userID, rootID, "outside.bin", 10)
	setTrashUsed(t, ctx, pool, userID, 30)

	var sharedChunkID, uniqueChunkID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO chunks (
			sha256, size_bytes,
			discord_channel_id, discord_message_id, discord_attachment_id,
			status, committed_at
		)
		VALUES (
			gen_random_bytes(32), 10,
			$1, $2, $3,
			'ready', now()
		)
		RETURNING id::text
	`, "shared-channel-"+userID, "shared-message-"+userID, "shared-attachment-"+userID).Scan(&sharedChunkID); err != nil {
		t.Fatalf("create shared chunk: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO chunks (
			sha256, size_bytes,
			discord_channel_id, discord_message_id, discord_attachment_id,
			status, committed_at
		)
		VALUES (
			gen_random_bytes(32), 10,
			$1, $2, $3,
			'ready', now()
		)
		RETURNING id::text
	`, "unique-channel-"+userID, "unique-message-"+userID, "unique-attachment-"+userID).Scan(&uniqueChunkID); err != nil {
		t.Fatalf("create unique chunk: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO file_chunks (file_id, part_index, chunk_id, part_size_bytes)
		VALUES
			($1::uuid, 0, $2::uuid, 10),
			($3::uuid, 0, $2::uuid, 10),
			($4::uuid, 0, $5::uuid, 10)
	`, fileID, sharedChunkID, outsideFileID, nestedFileID, uniqueChunkID); err != nil {
		t.Fatalf("create file chunk references: %v", err)
	}

	var collectionID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO collections (owner_user_id, name, name_key, created_by)
		VALUES ($1::uuid, 'Purge links', 'purge links', $1::uuid)
		RETURNING id::text
	`, userID).Scan(&collectionID); err != nil {
		t.Fatalf("create collection: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO collection_items (collection_id, file_id, added_by)
		VALUES ($1::uuid, $2::uuid, $3::uuid)
	`, collectionID, fileID, userID); err != nil {
		t.Fatalf("create collection item: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public_shares (public_id, resource_type, node_id, created_by)
		VALUES ($1, 'node', $2::uuid, $3::uuid)
	`, "purge-"+folder.ID, folder.ID, userID); err != nil {
		t.Fatalf("create public share: %v", err)
	}

	if err := service.Trash(ctx, actor, folder.ID); err != nil {
		t.Fatalf("trash folder: %v", err)
	}
	assertTrashUsed(t, ctx, pool, userID, 10)

	if err := service.PurgeKind(ctx, actor, folder.ID, "folder"); err != nil {
		t.Fatalf("purge folder: %v", err)
	}
	assertTrashUsed(t, ctx, pool, userID, 10)

	assertPurgeCount(t, ctx, pool, `SELECT COUNT(*) FROM nodes WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, 0, folder.ID, nested.ID, fileID)
	assertPurgeCount(t, ctx, pool, `SELECT COUNT(*) FROM files WHERE node_id IN ($1::uuid, $2::uuid)`, 0, fileID, nestedFileID)
	assertPurgeCount(t, ctx, pool, `SELECT COUNT(*) FROM file_chunks WHERE file_id IN ($1::uuid, $2::uuid)`, 0, fileID, nestedFileID)
	assertPurgeCount(t, ctx, pool, `SELECT COUNT(*) FROM collection_items WHERE file_id = $1::uuid`, 0, fileID)
	assertPurgeCount(t, ctx, pool, `SELECT COUNT(*) FROM public_shares WHERE node_id = $1::uuid`, 0, folder.ID)
	assertPurgeCount(t, ctx, pool, `SELECT COUNT(*) FROM chunks WHERE id = $1::uuid`, 0, uniqueChunkID)
	assertPurgeCount(t, ctx, pool, `SELECT COUNT(*) FROM chunks WHERE id = $1::uuid`, 1, sharedChunkID)
	assertPurgeCount(t, ctx, pool, `SELECT COUNT(*) FROM file_chunks WHERE file_id = $1::uuid AND chunk_id = $2::uuid`, 1, outsideFileID, sharedChunkID)

	if _, err := service.RestoreKind(ctx, actor, folder.ID, "folder", RestoreInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restore purged folder = %v", err)
	}
}

func TestPurgeRejectsActiveUpload(t *testing.T) {
	ctx, pool := openBatchTestPool(t)
	userID, rootID := createTreeUser(t, ctx, pool, "purge-upload-owner", false)
	service := New(pool)
	actor := Actor{UserID: userID}

	folder, err := service.CreateFolder(ctx, actor, rootID, "Upload target")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}

	var uploadID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO upload_sessions (
			actor_user_id, owner_user_id, parent_folder_id,
			name, name_key,
			size_bytes, chunk_size_bytes, expected_parts,
			reserved_bytes, status, expires_at
		)
		VALUES (
			$1::uuid, $1::uuid, $2::uuid,
			'pending.bin', 'pending.bin',
			0, 10, 0,
			0, 'open', now() + interval '1 hour'
		)
		RETURNING id::text
	`, userID, folder.ID).Scan(&uploadID); err != nil {
		t.Fatalf("create active upload: %v", err)
	}

	if err := service.Trash(ctx, actor, folder.ID); err != nil {
		t.Fatalf("trash folder: %v", err)
	}
	if err := service.PurgeKind(ctx, actor, folder.ID, "folder"); !errors.Is(err, ErrPurgeActiveUpload) {
		t.Fatalf("purge active upload target = %v", err)
	}

	assertPurgeCount(t, ctx, pool, `SELECT COUNT(*) FROM nodes WHERE id = $1::uuid`, 1, folder.ID)
	assertPurgeCount(t, ctx, pool, `SELECT COUNT(*) FROM upload_sessions WHERE id = $1::uuid`, 1, uploadID)

	if _, err := pool.Exec(ctx, `
		UPDATE upload_sessions
		SET status = 'cancelled', closed_at = now(), updated_at = now()
		WHERE id = $1::uuid
	`, uploadID); err != nil {
		t.Fatalf("cancel upload: %v", err)
	}

	if err := service.PurgeKind(ctx, actor, folder.ID, "folder"); err != nil {
		t.Fatalf("purge after cancel: %v", err)
	}

	assertPurgeCount(t, ctx, pool, `SELECT COUNT(*) FROM nodes WHERE id = $1::uuid`, 0, folder.ID)
	assertPurgeCount(t, ctx, pool, `SELECT COUNT(*) FROM upload_sessions WHERE id = $1::uuid`, 0, uploadID)
}

func assertPurgeCount(t *testing.T, ctx context.Context, pool interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, query string, want int64, args ...any) {
	t.Helper()

	var got int64
	if err := pool.QueryRow(ctx, query, args...).Scan(&got); err != nil {
		t.Fatalf("count purge rows: %v", err)
	}
	if got != want {
		t.Fatalf("row count = %d, want %d", got, want)
	}
}
