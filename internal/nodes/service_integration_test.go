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

func TestNodeTreeIntegration(t *testing.T) {
	dsn := os.Getenv("DISCLOUD_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("DISCLOUD_TEST_DATABASE_DSN is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	adminPool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open admin pool: %v", err)
	}
	defer adminPool.Close()

	schema := fmt.Sprintf("discloud_nodes_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()

	if _, err := adminPool.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	defer adminPool.Exec(context.Background(), "DROP SCHEMA "+identifier+" CASCADE")

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

	userID, rootID := createTreeUser(t, ctx, pool, "alice", false)
	otherID, otherRootID := createTreeUser(t, ctx, pool, "bob", false)
	adminID, _ := createTreeUser(t, ctx, pool, "admin", true)

	_ = otherID

	service := New(pool)
	user := Actor{UserID: userID}
	admin := Actor{UserID: adminID, Admin: true}

	a, err := service.CreateFolder(ctx, user, rootID, "A")
	if err != nil {
		t.Fatalf("create A: %v", err)
	}

	b, err := service.CreateFolder(ctx, user, a.ID, "B")
	if err != nil {
		t.Fatalf("create B: %v", err)
	}

	c, err := service.CreateFolder(ctx, user, b.ID, "C")
	if err != nil {
		t.Fatalf("create C: %v", err)
	}

	if _, err := service.CreateFolder(ctx, user, rootID, "Résumé"); err != nil {
		t.Fatalf("create normalized folder: %v", err)
	}

	if _, err := service.CreateFolder(ctx, user, rootID, "re\u0301sume\u0301"); !errors.Is(err, ErrNameConflict) {
		t.Fatalf("normalized duplicate = %v", err)
	}

	breadcrumbs, err := service.Breadcrumbs(ctx, user, c.ID)
	if err != nil {
		t.Fatalf("breadcrumbs: %v", err)
	}

	if len(breadcrumbs) != 4 {
		t.Fatalf("breadcrumbs = %d, want 4", len(breadcrumbs))
	}

	if !breadcrumbs[0].IsRoot ||
		breadcrumbs[1].ID != a.ID ||
		breadcrumbs[2].ID != b.ID ||
		breadcrumbs[3].ID != c.ID {
		t.Fatalf("unexpected breadcrumbs: %+v", breadcrumbs)
	}

	if _, err := service.Move(ctx, user, a.ID, c.ID); !errors.Is(err, ErrCycle) {
		t.Fatalf("cycle move = %v", err)
	}

	if _, err := service.Move(ctx, user, rootID, a.ID); !errors.Is(err, ErrRootImmutable) {
		t.Fatalf("root move = %v", err)
	}

	if _, err := service.Rename(ctx, user, rootID, "new-root"); !errors.Is(err, ErrRootImmutable) {
		t.Fatalf("root rename = %v", err)
	}

	if _, err := service.Move(ctx, admin, a.ID, otherRootID); !errors.Is(err, ErrCrossOwner) {
		t.Fatalf("cross-owner move = %v", err)
	}

	destination, err := service.CreateFolder(ctx, user, rootID, "Destination")
	if err != nil {
		t.Fatalf("create destination: %v", err)
	}

	if _, err := service.CreateFolder(ctx, user, destination.ID, "B"); err != nil {
		t.Fatalf("create conflicting B: %v", err)
	}

	if _, err := service.Move(ctx, user, b.ID, destination.ID); !errors.Is(err, ErrNameConflict) {
		t.Fatalf("move conflict = %v", err)
	}

	children, hasMore, err := service.ListChildren(ctx, user, rootID, 2, "", "")
	if err != nil {
		t.Fatalf("list children: %v", err)
	}

	if len(children) != 2 {
		t.Fatalf("children = %d, want 2", len(children))
	}
	if !hasMore {
		t.Fatal("expected additional children")
	}
}

func createTreeUser(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	username string,
	admin bool,
) (string, string) {
	t.Helper()

	role := "user"
	if admin {
		role = "admin"
	}

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, 'test-hash', $2)
		RETURNING id::text
	`, username, role).Scan(&userID); err != nil {
		t.Fatalf("create %s: %v", username, err)
	}

	var rootID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (
			kind,
			owner_user_id,
			name,
			name_key,
			is_root,
			created_by
		)
		VALUES ('folder', $1, '', '', true, $1)
		RETURNING id::text
	`, userID).Scan(&rootID); err != nil {
		t.Fatalf("create %s root: %v", username, err)
	}

	return userID, rootID
}
