package uploads

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/blobstore/fake"
)

func TestConcurrentQuotaReservationsDoNotOverReserve(t *testing.T) {
	ctx, pool := openUploadTestPool(t)

	quota := int64(100)
	userID, rootID := createUploadUser(
		t,
		ctx,
		pool,
		"quota-concurrency-owner",
		&quota,
	)

	service := New(pool, 10, time.Hour)

	type result struct {
		session Session
		err     error
	}

	start := make(chan struct{})
	results := make(chan result, 2)

	for _, value := range []string{
		"first.bin",
		"second.bin",
	} {
		name := value

		go func() {
			<-start
			session, err := service.Create(
				ctx,
				Actor{UserID: userID},
				CreateInput{
					ParentFolderID: rootID,
					Name:           name,
					SizeBytes:      60,
				},
			)
			results <- result{
				session: session,
				err:     err,
			}
		}()
	}

	close(start)

	var succeeded, rejected int
	for range 2 {
		result := <-results

		switch {
		case result.err == nil:
			succeeded++
			if result.session.ID == "" {
				t.Fatal(
					"successful reservation returned empty session ID",
				)
			}

		case errors.Is(result.err, ErrQuotaExceeded):
			rejected++

		default:
			t.Fatalf(
				"concurrent reservation: %v",
				result.err,
			)
		}
	}

	if succeeded != 1 || rejected != 1 {
		t.Fatalf(
			"succeeded=%d rejected=%d, want 1/1",
			succeeded,
			rejected,
		)
	}

	assertReservedBytes(t, ctx, pool, userID, 60)

	var sessions int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM upload_sessions
		WHERE owner_user_id = $1::uuid
		  AND status = 'open'
	`, userID).Scan(&sessions); err != nil {
		t.Fatalf("count open sessions: %v", err)
	}
	if sessions != 1 {
		t.Fatalf("open sessions = %d, want 1", sessions)
	}

	var used int64
	if err := pool.QueryRow(ctx, `
		SELECT storage_used_bytes
		FROM users
		WHERE id = $1::uuid
	`, userID).Scan(&used); err != nil {
		t.Fatalf("read used quota: %v", err)
	}
	if used != 0 {
		t.Fatalf("used bytes = %d, want 0", used)
	}
}

func TestConcurrentSameChunkUploadUsesOneCanonicalChunk(t *testing.T) {
	ctx, pool := openUploadTestPool(t)
	userID, rootID := createUploadUser(
		t,
		ctx,
		pool,
		"chunk-concurrency-owner",
		nil,
	)

	service := New(pool, 10, time.Hour)
	store := fake.New("bot-a", "bot-b")

	first, err := service.Create(
		ctx,
		Actor{UserID: userID},
		CreateInput{
			ParentFolderID: rootID,
			Name:           "first.bin",
			SizeBytes:      5,
		},
	)
	if err != nil {
		t.Fatalf("create first session: %v", err)
	}

	second, err := service.Create(
		ctx,
		Actor{UserID: userID},
		CreateInput{
			ParentFolderID: rootID,
			Name:           "second.bin",
			SizeBytes:      5,
		},
	)
	if err != nil {
		t.Fatalf("create second session: %v", err)
	}

	data := []byte("hello")
	digest := sha256.Sum256(data)

	type result struct {
		value PutPartResult
		err   error
	}

	start := make(chan struct{})
	results := make(chan result, 2)

	uploaderA := NewPartUploader(service, store)
	uploaderB := NewPartUploader(service, store)

	go func() {
		<-start
		value, err := uploaderA.PutPart(
			ctx,
			Actor{UserID: userID},
			first.ID,
			0,
			digest,
			bytes.NewReader(data),
		)
		results <- result{value: value, err: err}
	}()

	go func() {
		<-start
		value, err := uploaderB.PutPart(
			ctx,
			Actor{UserID: userID},
			second.ID,
			0,
			digest,
			bytes.NewReader(data),
		)
		results <- result{value: value, err: err}
	}()

	close(start)

	values := make([]PutPartResult, 0, 2)
	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatalf(
				"concurrent PutPart: %v",
				result.err,
			)
		}
		values = append(values, result.value)
	}

	if values[0].Part.ChunkID == "" ||
		values[0].Part.ChunkID != values[1].Part.ChunkID {
		t.Fatalf(
			"chunk IDs = %q and %q",
			values[0].Part.ChunkID,
			values[1].Part.ChunkID,
		)
	}

	var deduplicated int
	for _, value := range values {
		if value.Deduplicated {
			deduplicated++
		}
	}
	if deduplicated != 1 {
		t.Fatalf(
			"deduplicated results = %d, want 1",
			deduplicated,
		)
	}

	var chunks int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM chunks
		WHERE sha256 = $1
		  AND size_bytes = $2
	`, digest[:], len(data)).Scan(&chunks); err != nil {
		t.Fatalf("count canonical chunks: %v", err)
	}
	if chunks != 1 {
		t.Fatalf(
			"canonical chunks = %d, want 1",
			chunks,
		)
	}

	var distinctPartChunks int
	if err := pool.QueryRow(ctx, `
		SELECT count(DISTINCT chunk_id)
		FROM upload_parts
		WHERE upload_id IN ($1::uuid, $2::uuid)
	`, first.ID, second.ID).Scan(&distinctPartChunks); err != nil {
		t.Fatalf("count part chunk IDs: %v", err)
	}
	if distinctPartChunks != 1 {
		t.Fatalf(
			"distinct part chunks = %d, want 1",
			distinctPartChunks,
		)
	}

	var attempts int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM chunk_upload_attempts
		WHERE upload_session_id IN ($1::uuid, $2::uuid)
	`, first.ID, second.ID).Scan(&attempts); err != nil {
		t.Fatalf("count storage attempts: %v", err)
	}
	if attempts != 1 {
		t.Fatalf(
			"storage attempts = %d, want 1",
			attempts,
		)
	}
}

func TestConcurrentFinalizeIsIdempotent(t *testing.T) {
	ctx, pool := openUploadTestPool(t)

	quota := int64(100)
	userID, rootID := createUploadUser(
		t,
		ctx,
		pool,
		"finalize-concurrency-owner",
		&quota,
	)

	service := New(pool, 10, time.Hour)
	store := fake.New("bot-a")
	uploader := NewPartUploader(service, store)
	finalizer := NewFinalizer(service, store)

	data := []byte("hello")

	session, err := service.Create(
		ctx,
		Actor{UserID: userID},
		CreateInput{
			ParentFolderID: rootID,
			Name:           "concurrent.bin",
			SizeBytes:      int64(len(data)),
		},
	)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	digest := sha256.Sum256(data)
	if _, err := uploader.PutPart(
		ctx,
		Actor{UserID: userID},
		session.ID,
		0,
		digest,
		bytes.NewReader(data),
	); err != nil {
		t.Fatalf("upload part: %v", err)
	}

	type result struct {
		file CompletedFile
		err  error
	}

	start := make(chan struct{})
	results := make(chan result, 2)

	for range 2 {
		go func() {
			<-start
			file, err := finalizer.Finalize(
				ctx,
				Actor{UserID: userID},
				session.ID,
			)
			results <- result{
				file: file,
				err:  err,
			}
		}()
	}

	close(start)

	files := make([]CompletedFile, 0, 2)

	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatalf(
				"concurrent finalize: %v",
				result.err,
			)
		}
		files = append(files, result.file)
	}

	if files[0].ID == "" ||
		files[0].ID != files[1].ID {
		t.Fatalf(
			"finalized file IDs = %q and %q",
			files[0].ID,
			files[1].ID,
		)
	}

	var activeFiles int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM nodes
		WHERE parent_id = $1::uuid
		  AND name_key = 'concurrent.bin'
		  AND kind = 'file'
		  AND deleted_at IS NULL
	`, rootID).Scan(&activeFiles); err != nil {
		t.Fatalf("count active files: %v", err)
	}
	if activeFiles != 1 {
		t.Fatalf(
			"active files = %d, want 1",
			activeFiles,
		)
	}

	var used, reserved int64
	if err := pool.QueryRow(ctx, `
		SELECT
			storage_used_bytes,
			storage_reserved_bytes
		FROM users
		WHERE id = $1::uuid
	`, userID).Scan(&used, &reserved); err != nil {
		t.Fatalf("read quota: %v", err)
	}

	if used != int64(len(data)) || reserved != 0 {
		t.Fatalf(
			"quota used=%d reserved=%d, want %d/0",
			used,
			reserved,
			len(data),
		)
	}

	assertFinalizeSideEffects(
		t,
		ctx,
		service,
		files[0].ID,
		1,
		1,
	)

	var fileChunks int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM file_chunks
		WHERE file_id = $1::uuid
	`, files[0].ID).Scan(&fileChunks); err != nil {
		t.Fatalf("count file chunks: %v", err)
	}
	if fileChunks != 1 {
		t.Fatalf(
			"file chunks = %d, want 1",
			fileChunks,
		)
	}
}
