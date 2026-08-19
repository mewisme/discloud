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

func TestConcurrentSameNameCreateOnlyOneWins(t *testing.T) {
	ctx, pool := openNodeConcurrencyTestPool(t)
	userID, rootID := createTreeUser(t, ctx, pool, "concurrent-create-owner", false)

	service := New(pool)
	actor := Actor{UserID: userID}
	start := make(chan struct{})

	type result struct {
		node Node
		err  error
	}

	results := make(chan result, 2)
	names := []string{
		"Résumé",
		"re\u0301sume\u0301",
	}

	for _, value := range names {
		name := value
		go func() {
			<-start
			node, err := service.CreateFolder(ctx, actor, rootID, name)
			results <- result{node: node, err: err}
		}()
	}

	close(start)

	var succeeded, conflicted int
	for range 2 {
		result := <-results
		switch {
		case result.err == nil:
			succeeded++
			if result.node.ID == "" {
				t.Fatal("successful create returned empty node ID")
			}
		case errors.Is(result.err, ErrNameConflict):
			conflicted++
		default:
			t.Fatalf("concurrent create: %v", result.err)
		}
	}

	if succeeded != 1 || conflicted != 1 {
		t.Fatalf(
			"succeeded=%d conflicted=%d, want 1/1",
			succeeded,
			conflicted,
		)
	}

	_, nameKey, err := NormalizeName("Résumé")
	if err != nil {
		t.Fatalf("normalize expected name: %v", err)
	}

	var active int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM nodes
		WHERE parent_id = $1::uuid
		  AND name_key = $2
		  AND deleted_at IS NULL
	`, rootID, nameKey).Scan(&active); err != nil {
		t.Fatalf("count active duplicate names: %v", err)
	}
	if active != 1 {
		t.Fatalf("active normalized duplicates = %d, want 1", active)
	}
}

func TestConcurrentMoveAndTrashNeverResurrectsNode(t *testing.T) {
	ctx, pool := openNodeConcurrencyTestPool(t)
	userID, rootID := createTreeUser(t, ctx, pool, "move-trash-owner", false)

	service := New(pool)
	actor := Actor{UserID: userID}

	source, err := service.CreateFolder(ctx, actor, rootID, "Source")
	if err != nil {
		t.Fatalf("create source: %v", err)
	}

	destination, err := service.CreateFolder(ctx, actor, rootID, "Destination")
	if err != nil {
		t.Fatalf("create destination: %v", err)
	}

	start := make(chan struct{})
	moveResult := make(chan error, 1)
	trashResult := make(chan error, 1)

	go func() {
		<-start
		_, err := service.Move(ctx, actor, source.ID, destination.ID)
		moveResult <- err
	}()

	go func() {
		<-start
		trashResult <- service.Trash(ctx, actor, source.ID)
	}()

	close(start)

	moveErr := <-moveResult
	trashErr := <-trashResult

	if trashErr != nil {
		t.Fatalf("trash: %v", trashErr)
	}
	if moveErr != nil && !errors.Is(moveErr, ErrNotFound) {
		t.Fatalf("move: %v", moveErr)
	}

	state, err := loadNodeState(ctx, pool, source.ID, false)
	if err != nil {
		t.Fatalf("load final state: %v", err)
	}
	if state.DeletedAt == nil {
		t.Fatalf("source remained active after move/trash race: %+v", state)
	}

	if _, err := service.Get(ctx, actor, source.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("active lookup after trash = %v", err)
	}

	var trashAudits, moveAudits int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM audit_events
		WHERE action = 'node.trash'
		  AND resource_id = $1::uuid
	`, source.ID).Scan(&trashAudits); err != nil {
		t.Fatalf("count trash audits: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM audit_events
		WHERE action = 'node.move'
		  AND resource_id = $1::uuid
	`, source.ID).Scan(&moveAudits); err != nil {
		t.Fatalf("count move audits: %v", err)
	}

	if trashAudits != 1 {
		t.Fatalf("trash audits = %d, want 1", trashAudits)
	}

	wantMoveAudits := 0
	if moveErr == nil {
		wantMoveAudits = 1
	}
	if moveAudits != wantMoveAudits {
		t.Fatalf(
			"move audits = %d, want %d for move error %v",
			moveAudits,
			wantMoveAudits,
			moveErr,
		)
	}
}

func TestConcurrentRestoreAndConflictingCreateOnlyOneWins(t *testing.T) {
	ctx, pool := openNodeConcurrencyTestPool(t)
	userID, rootID := createTreeUser(t, ctx, pool, "restore-create-owner", false)

	service := New(pool)
	actor := Actor{UserID: userID}

	trashed, err := service.CreateFolder(ctx, actor, rootID, "Recovered")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if err := service.Trash(ctx, actor, trashed.ID); err != nil {
		t.Fatalf("trash folder: %v", err)
	}

	type result struct {
		operation string
		node      Node
		err       error
	}

	start := make(chan struct{})
	results := make(chan result, 2)

	go func() {
		<-start
		node, err := service.Restore(
			ctx,
			actor,
			trashed.ID,
			RestoreInput{},
		)
		results <- result{
			operation: "restore",
			node:      node,
			err:       err,
		}
	}()

	go func() {
		<-start
		node, err := service.CreateFolder(
			ctx,
			actor,
			rootID,
			"Recovered",
		)
		results <- result{
			operation: "create",
			node:      node,
			err:       err,
		}
	}()

	close(start)

	var succeeded, conflicted int
	for range 2 {
		result := <-results

		switch {
		case result.err == nil:
			succeeded++
			if result.node.ID == "" {
				t.Fatalf(
					"%s returned empty node ID",
					result.operation,
				)
			}

		case errors.Is(result.err, ErrNameConflict):
			conflicted++

		default:
			t.Fatalf(
				"%s returned unexpected error: %v",
				result.operation,
				result.err,
			)
		}
	}

	if succeeded != 1 || conflicted != 1 {
		t.Fatalf(
			"succeeded=%d conflicted=%d, want 1/1",
			succeeded,
			conflicted,
		)
	}

	_, nameKey, err := NormalizeName("Recovered")
	if err != nil {
		t.Fatalf("normalize name: %v", err)
	}

	var active int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM nodes
		WHERE parent_id = $1::uuid
		  AND name_key = $2
		  AND deleted_at IS NULL
	`, rootID, nameKey).Scan(&active); err != nil {
		t.Fatalf("count active nodes: %v", err)
	}
	if active != 1 {
		t.Fatalf("active conflicting nodes = %d, want 1", active)
	}
}

func openNodeConcurrencyTestPool(
	t *testing.T,
) (context.Context, *pgxpool.Pool) {
	t.Helper()

	dsn := os.Getenv("DISCLOUD_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("DISCLOUD_TEST_DATABASE_DSN is not set")
	}

	ctx, cancel := context.WithTimeout(
		context.Background(),
		30*time.Second,
	)

	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		cancel()
		t.Fatalf("open admin pool: %v", err)
	}

	schema := fmt.Sprintf(
		"discloud_node_concurrency_test_%d",
		time.Now().UnixNano(),
	)
	identifier := pgx.Identifier{schema}.Sanitize()

	if _, err := admin.Exec(
		ctx,
		"CREATE SCHEMA "+identifier,
	); err != nil {
		admin.Close()
		cancel()
		t.Fatalf("create schema: %v", err)
	}

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		admin.Close()
		cancel()
		t.Fatalf("parse DSN: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] =
		schema + ",public"

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		admin.Close()
		cancel()
		t.Fatalf("open isolated pool: %v", err)
	}

	logger := slog.New(
		slog.NewTextHandler(io.Discard, nil),
	)
	if err := migrate.Up(
		ctx,
		pool,
		migrations.FS,
		logger,
	); err != nil {
		pool.Close()
		admin.Close()
		cancel()
		t.Fatalf("migrate: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()

		cleanupCtx, cleanupCancel :=
			context.WithTimeout(
				context.Background(),
				10*time.Second,
			)
		defer cleanupCancel()

		_, _ = admin.Exec(
			cleanupCtx,
			"DROP SCHEMA "+identifier+" CASCADE",
		)
		admin.Close()
		cancel()
	})

	return ctx, pool
}
