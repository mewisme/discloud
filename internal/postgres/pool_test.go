package postgres

import (
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/config"
)

func TestPoolConfig(t *testing.T) {
	cfg := config.DatabaseConfig{
		DSN:               "postgres://discloud:secret@localhost:5432/discloud?sslmode=disable&pool_max_conns=99",
		MinConnections:    2,
		MaxConnections:    20,
		MaxConnectionLife: 2 * time.Hour,
		MaxConnectionIdle: 15 * time.Minute,
		HealthCheckPeriod: 30 * time.Second,
	}

	got, err := poolConfig(cfg)
	if err != nil {
		t.Fatalf("poolConfig() error: %v", err)
	}

	if got.MinConns != cfg.MinConnections {
		t.Fatalf("MinConns = %d, want %d", got.MinConns, cfg.MinConnections)
	}
	if got.MaxConns != cfg.MaxConnections {
		t.Fatalf("MaxConns = %d, want %d", got.MaxConns, cfg.MaxConnections)
	}
	if got.MaxConnLifetime != cfg.MaxConnectionLife {
		t.Fatalf("MaxConnLifetime = %s, want %s", got.MaxConnLifetime, cfg.MaxConnectionLife)
	}
	if got.MaxConnIdleTime != cfg.MaxConnectionIdle {
		t.Fatalf("MaxConnIdleTime = %s, want %s", got.MaxConnIdleTime, cfg.MaxConnectionIdle)
	}
	if got.HealthCheckPeriod != cfg.HealthCheckPeriod {
		t.Fatalf("HealthCheckPeriod = %s, want %s", got.HealthCheckPeriod, cfg.HealthCheckPeriod)
	}
}

func TestPoolConfigRejectsInvalidDSN(t *testing.T) {
	_, err := poolConfig(config.DatabaseConfig{DSN: "postgres://[::1"})
	if err == nil {
		t.Fatal("poolConfig() expected error")
	}
}
