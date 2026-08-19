package postgres

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/jobs"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestJobClaimSkipsLockedJob(t *testing.T) {
	pool := openTestPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := migrate.Up(ctx, pool, migrations.FS, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if _, err := pool.Exec(ctx, "TRUNCATE jobs"); err != nil {
		t.Fatalf("truncate jobs: %v", err)
	}

	var highID, lowID string
	if err := pool.QueryRow(ctx, "INSERT INTO jobs (type, priority) VALUES ('test.claim', 100) RETURNING id::text").Scan(&highID); err != nil {
		t.Fatalf("insert high priority job: %v", err)
	}
	if err := pool.QueryRow(ctx, "INSERT INTO jobs (type, priority) VALUES ('test.claim', 10) RETURNING id::text").Scan(&lowID); err != nil {
		t.Fatalf("insert low priority job: %v", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin lock transaction: %v", err)
	}

	var lockedID string
	if err := tx.QueryRow(ctx, "SELECT id::text FROM jobs ORDER BY priority DESC LIMIT 1 FOR UPDATE").Scan(&lockedID); err != nil {
		t.Fatalf("lock job: %v", err)
	}
	if lockedID != highID {
		t.Fatalf("locked ID = %s, want %s", lockedID, highID)
	}

	claimCtx, claimCancel := context.WithTimeout(ctx, time.Second)
	defer claimCancel()

	job, err := jobs.Claim(claimCtx, pool, "worker-a")
	if err != nil {
		t.Fatalf("claim unlocked job: %v", err)
	}
	if job == nil || job.ID != lowID {
		t.Fatalf("claimed job = %+v, want %s", job, lowID)
	}

	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback lock transaction: %v", err)
	}

	job, err = jobs.Claim(ctx, pool, "worker-b")
	if err != nil {
		t.Fatalf("claim high priority job: %v", err)
	}
	if job == nil || job.ID != highID {
		t.Fatalf("claimed job = %+v, want %s", job, highID)
	}
}
