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

type retryableStorageError struct {
	message string
}

func (e retryableStorageError) Error() string {
	return e.message
}

func (e retryableStorageError) StorageClass() string {
	return "unavailable"
}

func (e retryableStorageError) StorageRetryable() bool {
	return true
}

func TestPutPartRetryDedupeAndIdempotency(t *testing.T) {
	ctx, pool := openUploadTestPool(t)
	userID, rootID := createUploadUser(t, ctx, pool, "part-owner", nil)

	service := New(pool, 10, time.Hour)
	store := fake.New("bot-a", "bot-b", "bot-c")
	uploader := NewPartUploader(service, store)

	data := []byte("hello")
	digest := sha256.Sum256(data)

	session, err := service.Create(ctx, Actor{UserID: userID}, CreateInput{
		ParentFolderID: rootID,
		Name:           "first.bin",
		SizeBytes:      int64(len(data)),
	})
	if err != nil {
		t.Fatalf("create upload: %v", err)
	}

	store.FailNext("bot-a", retryableStorageError{"bot-a failed"})
	store.FailNext("bot-b", retryableStorageError{"bot-b failed"})

	result, err := uploader.PutPart(
		ctx,
		Actor{UserID: userID},
		session.ID,
		0,
		digest,
		bytes.NewReader(data),
	)
	if err != nil {
		t.Fatalf("PutPart(): %v", err)
	}
	if result.Deduplicated {
		t.Fatal("first part unexpectedly deduplicated")
	}

	assertAttempts(t, ctx, service, session.ID, 0, []attemptExpectation{
		{"bot-a", AttemptFailed},
		{"bot-b", AttemptFailed},
		{"bot-c", AttemptSucceeded},
	})

	retry, err := uploader.PutPart(
		ctx,
		Actor{UserID: userID},
		session.ID,
		0,
		digest,
		bytes.NewReader(nil),
	)
	if err != nil {
		t.Fatalf("idempotent PutPart(): %v", err)
	}
	if retry.Part.ChunkID != result.Part.ChunkID {
		t.Fatalf("retry chunk = %s, want %s", retry.Part.ChunkID, result.Part.ChunkID)
	}

	assertAttemptCount(t, ctx, service, session.ID, 0, 3)

	second, err := service.Create(ctx, Actor{UserID: userID}, CreateInput{
		ParentFolderID: rootID,
		Name:           "second.bin",
		SizeBytes:      int64(len(data)),
	})
	if err != nil {
		t.Fatalf("create second upload: %v", err)
	}

	deduped, err := uploader.PutPart(
		ctx,
		Actor{UserID: userID},
		second.ID,
		0,
		digest,
		bytes.NewReader(data),
	)
	if err != nil {
		t.Fatalf("deduped PutPart(): %v", err)
	}
	if !deduped.Deduplicated {
		t.Fatal("existing chunk was uploaded again")
	}
	if deduped.Part.ChunkID != result.Part.ChunkID {
		t.Fatalf("dedupe chunk = %s, want %s", deduped.Part.ChunkID, result.Part.ChunkID)
	}

	assertAttemptCount(t, ctx, service, second.ID, 0, 0)

	otherDigest := sha256.Sum256([]byte("other"))
	_, err = uploader.PutPart(
		ctx,
		Actor{UserID: userID},
		session.ID,
		0,
		otherDigest,
		bytes.NewReader(nil),
	)
	if !errors.Is(err, ErrPartConflict) {
		t.Fatalf("conflicting retry = %v", err)
	}
}

func TestPutPartRejectsHashMismatchBeforeBotSelection(t *testing.T) {
	ctx, pool := openUploadTestPool(t)
	userID, rootID := createUploadUser(t, ctx, pool, "hash-owner", nil)

	service := New(pool, 10, time.Hour)
	uploader := NewPartUploader(service, fake.New("bot-a"))

	data := []byte("hello")
	wrongDigest := sha256.Sum256([]byte("wrong"))

	session, err := service.Create(ctx, Actor{UserID: userID}, CreateInput{
		ParentFolderID: rootID,
		Name:           "hash.bin",
		SizeBytes:      int64(len(data)),
	})
	if err != nil {
		t.Fatalf("create upload: %v", err)
	}

	_, err = uploader.PutPart(
		ctx,
		Actor{UserID: userID},
		session.ID,
		0,
		wrongDigest,
		bytes.NewReader(data),
	)
	if !errors.Is(err, ErrPartHashMismatch) {
		t.Fatalf("hash mismatch = %v", err)
	}

	assertAttemptCount(t, ctx, service, session.ID, 0, 0)
}

type attemptExpectation struct {
	bot    string
	status AttemptStatus
}

func assertAttempts(t *testing.T, ctx context.Context, service *Service, uploadID string, partIndex int, want []attemptExpectation) {
	t.Helper()

	rows, err := service.pool.Query(ctx, `
		SELECT discord_bot_user_id, status
		FROM chunk_upload_attempts
		WHERE upload_session_id::text = $1 AND part_number = $2
		ORDER BY attempt_number
	`, uploadID, partIndex)
	if err != nil {
		t.Fatalf("query attempts: %v", err)
	}
	defer rows.Close()

	got := make([]attemptExpectation, 0, len(want))
	for rows.Next() {
		var item attemptExpectation
		if err := rows.Scan(&item.bot, &item.status); err != nil {
			t.Fatalf("scan attempt: %v", err)
		}
		got = append(got, item)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read attempts: %v", err)
	}

	if len(got) != len(want) {
		t.Fatalf("attempts = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("attempt %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func assertAttemptCount(t *testing.T, ctx context.Context, service *Service, uploadID string, partIndex, want int) {
	t.Helper()

	var got int
	if err := service.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM chunk_upload_attempts
		WHERE upload_session_id::text = $1 AND part_number = $2
	`, uploadID, partIndex).Scan(&got); err != nil {
		t.Fatalf("count attempts: %v", err)
	}
	if got != want {
		t.Fatalf("attempt count = %d, want %d", got, want)
	}
}
