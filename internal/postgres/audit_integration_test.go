package postgres

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestAuditAppendIntegration(t *testing.T) {
	pool := openTestPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := migrate.Up(ctx, pool, migrations.FS, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const action = "test.audit.append"
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), "DELETE FROM audit_events WHERE action = $1", action)
	})

	err := InTx(ctx, pool, func(tx pgx.Tx) error {
		return audit.Append(ctx, tx, audit.Event{
			Action:    action,
			RequestID: "test-request",
			Metadata:  map[string]any{"source": "integration"},
		})
	})
	if err != nil {
		t.Fatalf("append audit: %v", err)
	}

	var requestID string
	if err := pool.QueryRow(ctx, "SELECT request_id FROM audit_events WHERE action = $1", action).Scan(&requestID); err != nil {
		t.Fatalf("query audit: %v", err)
	}
	if requestID != "test-request" {
		t.Fatalf("request_id = %q, want test-request", requestID)
	}
}
