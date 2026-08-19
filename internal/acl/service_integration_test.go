package acl

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

func TestFolderACLIntegration(t *testing.T) {
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

	schema := fmt.Sprintf("discloud_acl_test_%d", time.Now().UnixNano())
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

	ownerID, rootID := createACLUser(t, ctx, pool, "owner", "user")
	guestID, _ := createACLUser(t, ctx, pool, "guest", "user")
	managerID, _ := createACLUser(t, ctx, pool, "manager", "user")
	adminID, _ := createACLUser(t, ctx, pool, "admin", "admin")

	aID := createACLFolder(t, ctx, pool, ownerID, rootID, "A")
	bID := createACLFolder(t, ctx, pool, ownerID, aID, "B")

	service := New(pool)

	assertACLLevel(t, ctx, service, bID, ownerID, false, Full)
	assertACLLevel(t, ctx, service, bID, adminID, true, Full)
	assertACLLevel(t, ctx, service, bID, guestID, false, None)

	owner := Actor{UserID: ownerID}

	if _, err := service.Set(ctx, owner, aID, guestID, View); err != nil {
		t.Fatalf("grant guest view: %v", err)
	}
	assertACLLevel(t, ctx, service, bID, guestID, false, View)

	if _, err := service.Set(ctx, owner, bID, guestID, Edit); err != nil {
		t.Fatalf("grant guest edit: %v", err)
	}
	assertACLLevel(t, ctx, service, bID, guestID, false, Edit)

	if _, err := service.Set(ctx, owner, aID, managerID, Full); err != nil {
		t.Fatalf("grant manager full: %v", err)
	}

	manager := Actor{UserID: managerID}
	if _, err := service.Set(ctx, manager, bID, guestID, Full); err != nil {
		t.Fatalf("inherited full grant management: %v", err)
	}
	assertACLLevel(t, ctx, service, bID, guestID, false, Full)

	if _, err := service.Set(ctx, owner, bID, guestID, View); err != nil {
		t.Fatalf("downgrade direct grant: %v", err)
	}
	assertACLLevel(t, ctx, service, bID, guestID, false, View)

	if _, err := service.List(ctx, Actor{UserID: guestID}, bID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest list grants = %v", err)
	}

	grants, err := service.List(ctx, manager, bID)
	if err != nil {
		t.Fatalf("manager list grants: %v", err)
	}
	if len(grants) != 1 || grants[0].UserID != guestID {
		t.Fatalf("grants = %+v", grants)
	}

	if _, err := service.Set(ctx, owner, aID, ownerID, Full); !errors.Is(err, ErrOwnerGrant) {
		t.Fatalf("owner self grant = %v", err)
	}

	if err := service.Delete(ctx, manager, bID, guestID); err != nil {
		t.Fatalf("delete grant: %v", err)
	}
	assertACLLevel(t, ctx, service, bID, guestID, false, View)
}

func assertACLLevel(
	t *testing.T,
	ctx context.Context,
	service *Service,
	nodeID string,
	userID string,
	admin bool,
	want Level,
) {
	t.Helper()

	got, err := service.Resolve(ctx, nodeID, userID, admin)
	if err != nil {
		t.Fatalf("Resolve() error: %v", err)
	}
	if got != want {
		t.Fatalf("Resolve() = %s, want %s", got.String(), want.String())
	}
}

func createACLUser(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	username string,
	role string,
) (string, string) {
	t.Helper()

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, 'test-hash', $2)
		RETURNING id::text
	`, username, role).Scan(&userID); err != nil {
		t.Fatalf("create user %s: %v", username, err)
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
		t.Fatalf("create root %s: %v", username, err)
	}

	return userID, rootID
}

func createACLFolder(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	ownerID string,
	parentID string,
	name string,
) string {
	t.Helper()

	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (
			kind,
			owner_user_id,
			parent_id,
			name,
			name_key,
			created_by
		)
		VALUES ('folder', $1, $2, $3, lower($3), $1)
		RETURNING id::text
	`, ownerID, parentID, name).Scan(&id); err != nil {
		t.Fatalf("create folder %s: %v", name, err)
	}

	return id
}
