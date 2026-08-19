package jobs

import (
	"context"
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

func TestRecoverStaleJobIntegration(t *testing.T) {
	ctx, pool := openJobTestPool(t)

	if _, err := pool.Exec(ctx, `
		INSERT INTO jobs (type, max_attempts)
		VALUES ('test.job', 2)
	`); err != nil {
		t.Fatalf("insert job: %v", err)
	}

	first, err := Claim(ctx, pool, "worker-1")
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if first == nil || first.Attempts != 1 {
		t.Fatalf("first claim = %+v", first)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE jobs
		SET locked_at = now() - interval '10 minutes'
		WHERE id = $1::uuid
	`, first.ID); err != nil {
		t.Fatalf("age lease: %v", err)
	}

	count, err := RecoverStale(ctx, pool, 5*time.Minute)
	if err != nil {
		t.Fatalf("recover stale: %v", err)
	}
	if count != 1 {
		t.Fatalf("recovered = %d, want 1", count)
	}

	second, err := Claim(ctx, pool, "worker-2")
	if err != nil {
		t.Fatalf("second claim: %v", err)
	}
	if second == nil || second.ID != first.ID || second.Attempts != 2 {
		t.Fatalf("second claim = %+v", second)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE jobs
		SET locked_at = now() - interval '10 minutes'
		WHERE id = $1::uuid
	`, second.ID); err != nil {
		t.Fatalf("age final lease: %v", err)
	}

	count, err = RecoverStale(ctx, pool, 5*time.Minute)
	if err != nil {
		t.Fatalf("recover final stale: %v", err)
	}
	if count != 1 {
		t.Fatalf("final recovered = %d, want 1", count)
	}

	var status, lastError string
	if err := pool.QueryRow(ctx, `
		SELECT status, COALESCE(last_error, '')
		FROM jobs
		WHERE id = $1::uuid
	`, second.ID).Scan(&status, &lastError); err != nil {
		t.Fatalf("read final job: %v", err)
	}
	if status != "dead" {
		t.Fatalf("status = %q, want dead", status)
	}
	if lastError == "" {
		t.Fatal("dead stale job has no diagnostic error")
	}
}

func TestTouchProtectsRunningJobIntegration(t *testing.T) {
	ctx, pool := openJobTestPool(t)

	if _, err := pool.Exec(ctx, `
		INSERT INTO jobs (type)
		VALUES ('test.job')
	`); err != nil {
		t.Fatalf("insert job: %v", err)
	}

	job, err := Claim(ctx, pool, "worker-1")
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if job == nil {
		t.Fatal("claim returned nil")
	}

	if err := Touch(ctx, pool, job.ID, "worker-1"); err != nil {
		t.Fatalf("touch: %v", err)
	}

	count, err := RecoverStale(ctx, pool, 5*time.Minute)
	if err != nil {
		t.Fatalf("recover stale: %v", err)
	}
	if count != 0 {
		t.Fatalf("recovered active jobs = %d, want 0", count)
	}

	if err := Complete(ctx, pool, job.ID, "worker-1"); err != nil {
		t.Fatalf("complete: %v", err)
	}
}

func openJobTestPool(t *testing.T) (context.Context, *pgxpool.Pool) {
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

	schema := fmt.Sprintf("discloud_job_test_%d", time.Now().UnixNano())
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
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = admin.Exec(cleanupCtx, "DROP SCHEMA "+identifier+" CASCADE")
		admin.Close()
		cancel()
	})

	return ctx, pool
}
