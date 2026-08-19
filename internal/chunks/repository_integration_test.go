package chunks

import (
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
	"github.com/mewisme/discloud/internal/postgres"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestChunkRepositoryIntegration(t *testing.T) {
	dsn := os.Getenv("DISCLOUD_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("DISCLOUD_TEST_DATABASE_DSN is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open admin pool: %v", err)
	}
	defer admin.Close()

	schema := fmt.Sprintf("discloud_chunks_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()

	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	defer admin.Exec(context.Background(), "DROP SCHEMA "+identifier+" CASCADE")

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse DSN: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	cfg.MaxConns = 16

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("open isolated pool: %v", err)
	}
	defer pool.Close()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := migrate.Up(ctx, pool, migrations.FS, logger); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	repository := New(pool)
	digest := sha256.Sum256([]byte("hello"))

	first, err := repository.Register(
		ctx,
		digest,
		5,
		blobstore.ChunkLocation{
			DiscordChannelID:    "channel-1",
			DiscordMessageID:    "message-1",
			DiscordAttachmentID: "attachment-1",
		},
	)
	if err != nil {
		t.Fatalf("register first chunk: %v", err)
	}
	if !first.Created {
		t.Fatal("first registration was not created")
	}

	duplicate, err := repository.Register(
		ctx,
		digest,
		5,
		blobstore.ChunkLocation{
			DiscordChannelID:    "channel-2",
			DiscordMessageID:    "message-2",
			DiscordAttachmentID: "attachment-2",
		},
	)
	if err != nil {
		t.Fatalf("register duplicate: %v", err)
	}
	if duplicate.Created {
		t.Fatal("duplicate registration created a new chunk")
	}
	if duplicate.Chunk.ID != first.Chunk.ID {
		t.Fatalf("duplicate ID = %s, want %s", duplicate.Chunk.ID, first.Chunk.ID)
	}
	if duplicate.Chunk.Location != first.Chunk.Location {
		t.Fatalf("duplicate location = %+v, want %+v", duplicate.Chunk.Location, first.Chunk.Location)
	}

	if err := postgres.InTx(ctx, pool, func(tx pgx.Tx) error {
		return repository.MarkReadyTx(ctx, tx, first.Chunk.ID)
	}); err != nil {
		t.Fatalf("mark ready: %v", err)
	}

	ready, err := repository.Get(ctx, first.Chunk.ID)
	if err != nil {
		t.Fatalf("get ready chunk: %v", err)
	}
	if ready.Status != StatusReady || ready.CommittedAt == nil {
		t.Fatalf("ready chunk = %+v", ready)
	}

	testConcurrentRegistration(t, ctx, repository)
}

func testConcurrentRegistration(
	t *testing.T,
	ctx context.Context,
	repository *Repository,
) {
	t.Helper()

	const workers = 8

	digest := sha256.Sum256([]byte("concurrent-chunk"))

	type result struct {
		registration RegisterResult
		err          error
	}

	results := make(chan result, workers)
	start := make(chan struct{})

	for i := range workers {
		go func() {
			<-start

			registration, err := repository.Register(
				ctx,
				digest,
				int64(len("concurrent-chunk")),
				blobstore.ChunkLocation{
					DiscordChannelID:    "race-channel",
					DiscordMessageID:    fmt.Sprintf("race-message-%d", i),
					DiscordAttachmentID: fmt.Sprintf("race-attachment-%d", i),
				},
			)

			results <- result{
				registration: registration,
				err:          err,
			}
		}()
	}

	close(start)

	created := 0
	var chunkID string

	for range workers {
		result := <-results
		if result.err != nil {
			t.Fatalf("concurrent registration: %v", result.err)
		}

		if result.registration.Created {
			created++
		}

		if chunkID == "" {
			chunkID = result.registration.Chunk.ID
		} else if result.registration.Chunk.ID != chunkID {
			t.Fatalf(
				"chunk ID = %s, want %s",
				result.registration.Chunk.ID,
				chunkID,
			)
		}
	}

	if created != 1 {
		t.Fatalf("created = %d, want 1", created)
	}
}
