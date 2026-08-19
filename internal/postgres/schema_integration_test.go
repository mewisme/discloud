package postgres

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestNodeRootInvariants(t *testing.T) {
	pool := openTestPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := migrate.Up(ctx, pool, migrations.FS, logger); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	tests := []struct {
		name string
		run  func(context.Context, pgx.Tx) error
	}{
		{
			name: "root folder",
			run: func(ctx context.Context, tx pgx.Tx) error {
				return insertNode(ctx, tx, "10000000-0000-7000-8000-000000000001", "folder", true, nil)
			},
		},
		{
			name: "root cannot be file",
			run: func(ctx context.Context, tx pgx.Tx) error {
				return insertNode(ctx, tx, "10000000-0000-7000-8000-000000000002", "file", true, nil)
			},
		},
		{
			name: "non-root requires parent",
			run: func(ctx context.Context, tx pgx.Tx) error {
				return insertNode(ctx, tx, "10000000-0000-7000-8000-000000000003", "folder", false, nil)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatalf("begin: %v", err)
			}
			defer tx.Rollback(ctx)

			userID := "00000000-0000-7000-8000-000000000001"
			if _, err := tx.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'hash')`, userID, "user-"+tt.name); err != nil {
				t.Fatalf("insert user: %v", err)
			}

			err = tt.run(ctx, tx)
			wantErr := tt.name != "root folder"
			if (err != nil) != wantErr {
				t.Fatalf("insert node error = %v, wantErr = %v", err, wantErr)
			}
		})
	}
}

func insertNode(ctx context.Context, tx pgx.Tx, id, kind string, root bool, parent any) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO nodes (id, kind, owner_user_id, parent_id, name, name_key, is_root, created_by)
		VALUES ($1, $2, '00000000-0000-7000-8000-000000000001', $3, 'root', 'root', $4, '00000000-0000-7000-8000-000000000001')
	`, id, kind, parent, root)
	return err
}
