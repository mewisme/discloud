package postgres

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

func TestMigrationsOnEmptySchema(t *testing.T) {
	admin := openTestPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	schema := fmt.Sprintf("discloud_migration_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()

	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatalf("create schema: %v", err)
	}

	cfg, err := pgxpool.ParseConfig(os.Getenv("DISCLOUD_TEST_DATABASE_DSN"))
	if err != nil {
		t.Fatalf("parse test DSN: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("open isolated pool: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+identifier+" CASCADE")
	})

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := migrate.Up(ctx, pool, migrations.FS, logger); err != nil {
		t.Fatalf("first migrate: %v", err)
	}
	if err := migrate.Up(ctx, pool, migrations.FS, logger); err != nil {
		t.Fatalf("second migrate: %v", err)
	}

	want := []string{"schema_migrations", "users", "nodes", "audit_events", "jobs"}

	var got int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM information_schema.tables
		WHERE table_schema = $1 AND table_name = ANY($2)
	`, schema, want).Scan(&got); err != nil {
		t.Fatalf("query migrated tables: %v", err)
	}
	if got != len(want) {
		t.Fatalf("migrated tables = %d, want %d", got, len(want))
	}
}
