package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/config"
)

func openTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	dsn := os.Getenv("DISCLOUD_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("DISCLOUD_TEST_DATABASE_DSN is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := Open(ctx, config.DatabaseConfig{
		DSN:               dsn,
		MaxConnections:    4,
		MaxConnectionLife: time.Hour,
		MaxConnectionIdle: 30 * time.Minute,
		HealthCheckPeriod: time.Minute,
	})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}

	t.Cleanup(pool.Close)
	return pool
}
