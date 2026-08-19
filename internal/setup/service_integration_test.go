package setup

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

func TestConcurrentSetupOnlyOneWins(t *testing.T) {
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

	schema := fmt.Sprintf("discloud_setup_test_%d", time.Now().UnixNano())
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

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("open isolated pool: %v", err)
	}
	defer pool.Close()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := migrate.Up(ctx, pool, migrations.FS, logger); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	service := New(pool)
	start := make(chan struct{})

	type result struct {
		id  string
		err error
	}
	results := make(chan result, 2)

	for i := range 2 {
		go func() {
			<-start
			id, err := service.Complete(ctx, fmt.Sprintf("admin-%d", i), "correct-horse-battery-staple")
			results <- result{id: id, err: err}
		}()
	}

	close(start)

	var succeeded, rejected int
	for range 2 {
		result := <-results
		switch {
		case result.err == nil:
			succeeded++
			if result.id == "" {
				t.Fatal("successful setup returned empty user ID")
			}
		case errors.Is(result.err, ErrAlreadySetup):
			rejected++
		default:
			t.Fatalf("setup error: %v", result.err)
		}
	}

	if succeeded != 1 || rejected != 1 {
		t.Fatalf("succeeded=%d rejected=%d, want 1/1", succeeded, rejected)
	}

	var admins, roots int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM users WHERE role = 'admin'").Scan(&admins); err != nil {
		t.Fatalf("count admins: %v", err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM nodes WHERE is_root").Scan(&roots); err != nil {
		t.Fatalf("count roots: %v", err)
	}

	if admins != 1 || roots != 1 {
		t.Fatalf("admins=%d roots=%d, want 1/1", admins, roots)
	}
}
