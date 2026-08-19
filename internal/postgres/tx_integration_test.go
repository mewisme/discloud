package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestInTx(t *testing.T) {
	pool := openTestPool(t)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const table = "discloud_tx_helper_test"

	if _, err := pool.Exec(ctx, "CREATE TABLE IF NOT EXISTS "+table+" (value text PRIMARY KEY)"); err != nil {
		t.Fatalf("create test table: %v", err)
	}
	if _, err := pool.Exec(ctx, "TRUNCATE "+table); err != nil {
		t.Fatalf("truncate test table: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), "DROP TABLE IF EXISTS "+table)
	})

	if err := InTx(ctx, pool, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "INSERT INTO "+table+" (value) VALUES ('committed')")
		return err
	}); err != nil {
		t.Fatalf("commit transaction: %v", err)
	}

	wantRollback := errors.New("rollback")
	err := InTx(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "INSERT INTO "+table+" (value) VALUES ('rolled-back')"); err != nil {
			return err
		}
		return wantRollback
	})
	if !errors.Is(err, wantRollback) {
		t.Fatalf("InTx() error = %v, want %v", err, wantRollback)
	}

	var committed, rolledBack bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM "+table+" WHERE value = 'committed')").Scan(&committed); err != nil {
		t.Fatalf("query committed row: %v", err)
	}
	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM "+table+" WHERE value = 'rolled-back')").Scan(&rolledBack); err != nil {
		t.Fatalf("query rolled-back row: %v", err)
	}

	if !committed {
		t.Fatal("committed transaction was not persisted")
	}
	if rolledBack {
		t.Fatal("failed transaction was not rolled back")
	}
}
