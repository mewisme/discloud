package nodes

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestCreateFolderBatchIntegration(t *testing.T) {
	ctx, pool := openBatchTestPool(t)
	userID, rootID := createTreeUser(t, ctx, pool, "batch-user", false)
	service := New(pool)

	inputs := []BatchFolderInput{
		{ClientID: "specs", ParentClientID: "docs", Name: "Specs"},
		{ClientID: "docs", Name: "Docs"},
		{ClientID: "api", ParentClientID: "specs", Name: "API"},
	}

	first, err := service.CreateFolderBatch(ctx, Actor{UserID: userID}, rootID, inputs)
	if err != nil {
		t.Fatalf("create batch: %v", err)
	}

	ids := batchIDs(first)
	if len(ids) != 3 {
		t.Fatalf("results = %d, want 3", len(ids))
	}
	for _, result := range first {
		if !result.Created {
			t.Fatalf("%s was not created", result.ClientID)
		}
	}

	breadcrumbs, err := service.Breadcrumbs(ctx, Actor{UserID: userID}, ids["api"])
	if err != nil {
		t.Fatalf("breadcrumbs: %v", err)
	}
	if len(breadcrumbs) != 4 ||
		breadcrumbs[1].ID != ids["docs"] ||
		breadcrumbs[2].ID != ids["specs"] ||
		breadcrumbs[3].ID != ids["api"] {
		t.Fatalf("unexpected breadcrumbs: %+v", breadcrumbs)
	}

	second, err := service.CreateFolderBatch(ctx, Actor{UserID: userID}, rootID, inputs)
	if err != nil {
		t.Fatalf("retry batch: %v", err)
	}
	for _, result := range second {
		if result.Created {
			t.Fatalf("%s recreated on retry", result.ClientID)
		}
		if result.Node.ID != ids[result.ClientID] {
			t.Fatalf("%s ID changed", result.ClientID)
		}
	}

	_, err = service.CreateFolderBatch(ctx, Actor{UserID: userID}, rootID, []BatchFolderInput{
		{ClientID: "x", ParentClientID: "y", Name: "X"},
		{ClientID: "y", ParentClientID: "x", Name: "Y"},
	})
	if !errors.Is(err, ErrInvalidBatch) {
		t.Fatalf("cycle = %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM nodes
		WHERE parent_id = $1::uuid
		  AND name IN ('X', 'Y')
	`, rootID).Scan(&count); err != nil {
		t.Fatalf("count rolled back folders: %v", err)
	}
	if count != 0 {
		t.Fatalf("cycle created %d folders", count)
	}
}

func batchIDs(results []BatchFolderResult) map[string]string {
	ids := make(map[string]string, len(results))
	for _, result := range results {
		ids[result.ClientID] = result.Node.ID
	}
	return ids
}

func openBatchTestPool(t *testing.T) (context.Context, *pgxpool.Pool) {
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

	schema := fmt.Sprintf("discloud_batch_test_%d", time.Now().UnixNano())
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
		t.Fatalf("open pool: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := migrate.Up(ctx, pool, migrations.FS, logger); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = admin.Exec(cleanupCtx, "DROP SCHEMA "+identifier+" CASCADE")
		admin.Close()
		cancel()
	})
	return ctx, pool
}
