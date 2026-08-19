package orphangc

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/blobstore/fake"
	"github.com/mewisme/discloud/internal/chunks"
	"github.com/mewisme/discloud/internal/postgres"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestSweepDeletesOnlySafeUncommittedChunks(t *testing.T) {
	ctx, pool := openOrphanTestPool(t)
	store := fake.New("bot-a")
	repository := chunks.New(pool)
	service := New(
		pool,
		store,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)

	userID, rootID := createOrphanUser(t, ctx, pool, "orphan-owner")

	orphan := createOrphanChunk(t, ctx, pool, repository, store, "orphan")
	active := createOrphanChunk(t, ctx, pool, repository, store, "active")
	closed := createOrphanChunk(t, ctx, pool, repository, store, "closed")
	ready := createOrphanChunk(t, ctx, pool, repository, store, "ready")

	openUpload := createOrphanUpload(t, ctx, pool, userID, rootID, "open")
	closedUpload := createOrphanUpload(t, ctx, pool, userID, rootID, "failed")

	attachOrphanPart(t, ctx, pool, openUpload, active)
	attachOrphanPart(t, ctx, pool, closedUpload, closed)

	if err := postgres.InTx(ctx, pool, func(tx pgx.Tx) error {
		return repository.MarkReadyTx(ctx, tx, ready.ID)
	}); err != nil {
		t.Fatalf("mark ready: %v", err)
	}

	result, err := service.Sweep(ctx)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if result.DeletedChunks != 2 {
		t.Fatalf("deleted chunks = %d, want 2", result.DeletedChunks)
	}
	if result.DeletedBytes != orphan.SizeBytes+closed.SizeBytes {
		t.Fatalf("deleted bytes = %d", result.DeletedBytes)
	}

	assertChunkExists(t, ctx, pool, active.ID, true)
	assertChunkExists(t, ctx, pool, ready.ID, true)
	assertChunkExists(t, ctx, pool, orphan.ID, false)
	assertChunkExists(t, ctx, pool, closed.ID, false)

	if _, err := store.OpenChunk(ctx, orphan.Location, 0, 0); err == nil {
		t.Fatal("orphan Discord blob still exists")
	}
	if _, err := store.OpenChunk(ctx, closed.Location, 0, 0); err == nil {
		t.Fatal("closed-session Discord blob still exists")
	}

	activeReader, err := store.OpenChunk(ctx, active.Location, 0, 0)
	if err != nil {
		t.Fatalf("active blob was deleted: %v", err)
	}
	activeReader.Close()

	readyReader, err := store.OpenChunk(ctx, ready.Location, 0, 0)
	if err != nil {
		t.Fatalf("ready blob was deleted: %v", err)
	}
	readyReader.Close()
}

func createOrphanChunk(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	repository *chunks.Repository,
	store *fake.Store,
	value string,
) chunks.Chunk {
	t.Helper()

	data := []byte(value)
	digest := sha256.Sum256(data)

	put, err := store.PutChunk(
		ctx,
		nil,
		bytes.NewReader(data),
		int64(len(data)),
		digest,
	)
	if err != nil {
		t.Fatalf("put fake chunk: %v", err)
	}

	registration, err := repository.Register(
		ctx,
		digest,
		int64(len(data)),
		put.Location,
	)
	if err != nil {
		t.Fatalf("register chunk: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE chunks
		SET created_at = now() - interval '48 hours'
		WHERE id = $1::uuid
	`, registration.Chunk.ID); err != nil {
		t.Fatalf("age chunk: %v", err)
	}

	return registration.Chunk
}

func createOrphanUpload(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	userID, rootID, status string,
) string {
	t.Helper()

	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO upload_sessions (
			actor_user_id,
			owner_user_id,
			parent_folder_id,
			name,
			name_key,
			size_bytes,
			chunk_size_bytes,
			expected_parts,
			reserved_bytes,
			status,
			expires_at
		)
		VALUES (
			$1::uuid,
			$1::uuid,
			$2::uuid,
			$3,
			$3,
			10,
			10,
			1,
			0,
			$4,
			now() + interval '1 hour'
		)
		RETURNING id::text
	`, userID, rootID, "upload-"+status, status).Scan(&id); err != nil {
		t.Fatalf("create %s upload: %v", status, err)
	}

	return id
}

func attachOrphanPart(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	uploadID string,
	chunk chunks.Chunk,
) {
	t.Helper()

	if _, err := pool.Exec(ctx, `
		INSERT INTO upload_parts (
			upload_id,
			part_index,
			chunk_id,
			part_size_bytes,
			sha256
		)
		VALUES ($1::uuid, 0, $2::uuid, $3, $4)
	`, uploadID, chunk.ID, chunk.SizeBytes, chunk.SHA256[:]); err != nil {
		t.Fatalf("attach orphan part: %v", err)
	}
}

func assertChunkExists(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	id string,
	want bool,
) {
	t.Helper()

	var exists bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM chunks
			WHERE id = $1::uuid
		)
	`, id).Scan(&exists); err != nil {
		t.Fatalf("check chunk: %v", err)
	}

	if exists != want {
		t.Fatalf("chunk %s exists=%v, want %v", id, exists, want)
	}
}

func createOrphanUser(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	username string,
) (string, string) {
	t.Helper()

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash)
		VALUES ($1, 'test-hash')
		RETURNING id::text
	`, username).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	var rootID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (
			kind,
			owner_user_id,
			name,
			name_key,
			is_root,
			created_by
		)
		VALUES ('folder', $1::uuid, '', '', true, $1::uuid)
		RETURNING id::text
	`, userID).Scan(&rootID); err != nil {
		t.Fatalf("create root: %v", err)
	}

	return userID, rootID
}

func openOrphanTestPool(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()

	dsn := os.Getenv("DISCLOUD_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("DISCLOUD_TEST_DATABASE_DSN is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		cancel()
		t.Fatalf("open admin pool: %v", err)
	}

	schema := fmt.Sprintf("discloud_orphan_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()

	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		admin.Close()
		cancel()
		t.Fatalf("create schema: %v", err)
	}

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse DSN: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("open isolated pool: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := migrate.Up(ctx, pool, migrations.FS, logger); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()

		cleanupCtx, cleanupCancel := context.WithTimeout(
			context.Background(),
			10*time.Second,
		)
		defer cleanupCancel()

		_, _ = admin.Exec(
			cleanupCtx,
			"DROP SCHEMA "+identifier+" CASCADE",
		)
		admin.Close()
		cancel()
	})

	return ctx, pool
}

var _ blobstore.TechnicalBlobStore = (*fake.Store)(nil)
