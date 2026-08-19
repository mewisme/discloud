package uploads

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/blobstore/fake"
)

func TestFinalizeUploadIntegration(t *testing.T) {
	ctx, pool := openUploadTestPool(t)
	quota := int64(100)
	userID, rootID := createUploadUser(t, ctx, pool, "finalize-owner", &quota)

	service := New(pool, 10, time.Hour)
	store := fake.New("bot-a")
	uploader := NewPartUploader(service, store)
	finalizer := NewFinalizer(service, store)

	data := []byte("abcdefghijklmnopqrstuvwxy")
	fileDigest := sha256.Sum256(data)

	session, err := service.Create(ctx, Actor{UserID: userID}, CreateInput{
		ParentFolderID: rootID,
		Name:           "video.bin",
		SizeBytes:      int64(len(data)),
		MIMETypeHint:   "video/test",
		FileSHA256:     fileDigest[:],
	})
	if err != nil {
		t.Fatalf("create upload: %v", err)
	}

	for index, part := range [][]byte{data[:10], data[10:20], data[20:]} {
		digest := sha256.Sum256(part)
		if _, err := uploader.PutPart(
			ctx,
			Actor{UserID: userID},
			session.ID,
			index,
			digest,
			bytes.NewReader(part),
		); err != nil {
			t.Fatalf("upload part %d: %v", index, err)
		}
	}

	file, err := finalizer.Finalize(ctx, Actor{UserID: userID}, session.ID)
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}

	if file.ID == "" || file.OwnerUserID != userID || file.SizeBytes != int64(len(data)) {
		t.Fatalf("file = %+v", file)
	}
	if !bytes.Equal(file.SHA256, fileDigest[:]) {
		t.Fatalf("file SHA-256 = %x, want %x", file.SHA256, fileDigest)
	}
	if file.MIMEType != "application/octet-stream" {
		t.Fatalf("mime = %q", file.MIMEType)
	}

	var kind string
	if err := pool.QueryRow(ctx, `
		SELECT kind
		FROM nodes
		WHERE id::text = $1
	`, file.ID).Scan(&kind); err != nil {
		t.Fatalf("read file node: %v", err)
	}
	if kind != "file" {
		t.Fatalf("kind = %q, want file", kind)
	}

	var chunkCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM file_chunks
		WHERE file_id::text = $1
	`, file.ID).Scan(&chunkCount); err != nil {
		t.Fatalf("count file chunks: %v", err)
	}
	if chunkCount != 3 {
		t.Fatalf("file chunks = %d, want 3", chunkCount)
	}

	var unready int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM chunks c
		JOIN file_chunks fc ON fc.chunk_id = c.id
		WHERE fc.file_id::text = $1
		  AND (c.status <> 'ready' OR c.committed_at IS NULL)
	`, file.ID).Scan(&unready); err != nil {
		t.Fatalf("count unready chunks: %v", err)
	}
	if unready != 0 {
		t.Fatalf("unready chunks = %d", unready)
	}

	var used, reserved int64
	if err := pool.QueryRow(ctx, `
		SELECT storage_used_bytes, storage_reserved_bytes
		FROM users
		WHERE id::text = $1
	`, userID).Scan(&used, &reserved); err != nil {
		t.Fatalf("read quota: %v", err)
	}
	if used != int64(len(data)) || reserved != 0 {
		t.Fatalf("quota used=%d reserved=%d", used, reserved)
	}

	completed, err := service.Get(ctx, Actor{UserID: userID}, session.ID)
	if err != nil {
		t.Fatalf("get completed session: %v", err)
	}
	if completed.Status != StatusCompleted || completed.CommittedFileID != file.ID {
		t.Fatalf("completed session = %+v", completed)
	}

	assertFinalizeSideEffects(t, ctx, service, file.ID, 1, 1)

	again, err := finalizer.Finalize(ctx, Actor{UserID: userID}, session.ID)
	if err != nil {
		t.Fatalf("idempotent finalize: %v", err)
	}
	if again.ID != file.ID {
		t.Fatalf("second file ID = %s, want %s", again.ID, file.ID)
	}

	assertFinalizeSideEffects(t, ctx, service, file.ID, 1, 1)

	if err := pool.QueryRow(ctx, `
		SELECT storage_used_bytes, storage_reserved_bytes
		FROM users
		WHERE id::text = $1
	`, userID).Scan(&used, &reserved); err != nil {
		t.Fatalf("read quota after retry: %v", err)
	}
	if used != int64(len(data)) || reserved != 0 {
		t.Fatalf("retry quota used=%d reserved=%d", used, reserved)
	}
}

func TestFinalizeRequiresAllParts(t *testing.T) {
	ctx, pool := openUploadTestPool(t)
	userID, rootID := createUploadUser(t, ctx, pool, "incomplete-owner", nil)

	service := New(pool, 10, time.Hour)
	store := fake.New("bot-a")
	uploader := NewPartUploader(service, store)
	finalizer := NewFinalizer(service, store)

	session, err := service.Create(ctx, Actor{UserID: userID}, CreateInput{
		ParentFolderID: rootID,
		Name:           "incomplete.bin",
		SizeBytes:      15,
	})
	if err != nil {
		t.Fatalf("create upload: %v", err)
	}

	part := []byte("0123456789")
	digest := sha256.Sum256(part)
	if _, err := uploader.PutPart(ctx, Actor{UserID: userID}, session.ID, 0, digest, bytes.NewReader(part)); err != nil {
		t.Fatalf("upload part: %v", err)
	}

	_, err = finalizer.Finalize(ctx, Actor{UserID: userID}, session.ID)
	if !errors.Is(err, ErrIncompleteUpload) {
		t.Fatalf("finalize incomplete = %v", err)
	}

	assertReservedBytes(t, ctx, pool, userID, 15)
}

func TestFinalizeRejectsFileHashMismatch(t *testing.T) {
	ctx, pool := openUploadTestPool(t)
	userID, rootID := createUploadUser(t, ctx, pool, "hash-finalize-owner", nil)

	service := New(pool, 10, time.Hour)
	store := fake.New("bot-a")
	uploader := NewPartUploader(service, store)
	finalizer := NewFinalizer(service, store)

	data := []byte("hello")
	wrong := sha256.Sum256([]byte("wrong"))

	session, err := service.Create(ctx, Actor{UserID: userID}, CreateInput{
		ParentFolderID: rootID,
		Name:           "hash.bin",
		SizeBytes:      int64(len(data)),
		FileSHA256:     wrong[:],
	})
	if err != nil {
		t.Fatalf("create upload: %v", err)
	}

	partDigest := sha256.Sum256(data)
	if _, err := uploader.PutPart(ctx, Actor{UserID: userID}, session.ID, 0, partDigest, bytes.NewReader(data)); err != nil {
		t.Fatalf("upload part: %v", err)
	}

	_, err = finalizer.Finalize(ctx, Actor{UserID: userID}, session.ID)
	if !errors.Is(err, ErrFileHashMismatch) {
		t.Fatalf("hash mismatch = %v", err)
	}

	assertReservedBytes(t, ctx, pool, userID, int64(len(data)))

	session, err = service.Get(ctx, Actor{UserID: userID}, session.ID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if session.Status != StatusOpen {
		t.Fatalf("status = %s, want open", session.Status)
	}
}

func TestFinalizeRechecksNameConflict(t *testing.T) {
	ctx, pool := openUploadTestPool(t)
	userID, rootID := createUploadUser(t, ctx, pool, "conflict-finalize-owner", nil)

	service := New(pool, 10, time.Hour)
	store := fake.New("bot-a")
	uploader := NewPartUploader(service, store)
	finalizer := NewFinalizer(service, store)

	data := []byte("hello")
	session, err := service.Create(ctx, Actor{UserID: userID}, CreateInput{
		ParentFolderID: rootID,
		Name:           "taken.bin",
		SizeBytes:      int64(len(data)),
	})
	if err != nil {
		t.Fatalf("create upload: %v", err)
	}

	digest := sha256.Sum256(data)
	if _, err := uploader.PutPart(ctx, Actor{UserID: userID}, session.ID, 0, digest, bytes.NewReader(data)); err != nil {
		t.Fatalf("upload part: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO nodes (kind, owner_user_id, parent_id, name, name_key, created_by)
		VALUES ('folder', $1, $2, 'taken.bin', 'taken.bin', $1)
	`, userID, rootID); err != nil {
		t.Fatalf("create conflicting node: %v", err)
	}

	_, err = finalizer.Finalize(ctx, Actor{UserID: userID}, session.ID)
	if !errors.Is(err, ErrNameConflict) {
		t.Fatalf("name conflict = %v", err)
	}

	assertReservedBytes(t, ctx, pool, userID, int64(len(data)))
}

func assertFinalizeSideEffects(t *testing.T, ctx context.Context, service *Service, fileID string, jobs, audits int) {
	t.Helper()

	var jobCount int
	if err := service.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM jobs
		WHERE type = 'file.metadata'
		  AND payload->>'fileId' = $1
	`, fileID).Scan(&jobCount); err != nil {
		t.Fatalf("count metadata jobs: %v", err)
	}
	if jobCount != jobs {
		t.Fatalf("metadata jobs = %d, want %d", jobCount, jobs)
	}

	var auditCount int
	if err := service.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM audit_events
		WHERE action = 'file.create'
		  AND resource_id::text = $1
	`, fileID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit events: %v", err)
	}
	if auditCount != audits {
		t.Fatalf("audit events = %d, want %d", auditCount, audits)
	}
}
