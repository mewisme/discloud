package shares

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/collections"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestShareCreateRevokeRegenerateIntegration(t *testing.T) {
	ctx, pool := openShareTestPool(t)
	ownerID, rootID := createShareUser(t, ctx, pool, "share-owner")
	viewerID, _ := createShareUser(t, ctx, pool, "share-viewer")
	fileID := createShareFile(t, ctx, pool, ownerID, rootID, "private.bin")

	service := New(pool, collections.New(pool))
	owner := Actor{UserID: ownerID}

	first, err := service.Create(ctx, owner, CreateInput{
		ResourceType: ResourceFile,
		ResourceID:   fileID,
	})
	if err != nil {
		t.Fatalf("create share: %v", err)
	}
	if !first.Created {
		t.Fatal("first create was not created")
	}
	if len(first.Share.PublicID) != 43 {
		t.Fatalf("public ID length = %d, want 43", len(first.Share.PublicID))
	}
	if strings.ContainsAny(first.Share.PublicID, "+/=") {
		t.Fatalf("public ID is not raw URL-safe base64: %q", first.Share.PublicID)
	}

	second, err := service.Create(ctx, owner, CreateInput{
		ResourceType: ResourceFile,
		ResourceID:   fileID,
	})
	if err != nil {
		t.Fatalf("idempotent create: %v", err)
	}
	if second.Created || second.Share.ID != first.Share.ID || second.Share.PublicID != first.Share.PublicID {
		t.Fatalf("second create = %+v, want existing share", second)
	}

	_, err = service.Create(ctx, Actor{UserID: viewerID}, CreateInput{
		ResourceType: ResourceFile,
		ResourceID:   fileID,
	})
	if !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized create = %v", err)
	}

	resolved, err := service.Resolve(ctx, first.Share.PublicID)
	if err != nil {
		t.Fatalf("resolve share: %v", err)
	}
	if resolved.ResourceType != ResourceFile || resolved.ResourceID != fileID {
		t.Fatalf("resolved = %+v", resolved)
	}

	if err := service.Revoke(ctx, owner, first.Share.ID); err != nil {
		t.Fatalf("revoke share: %v", err)
	}
	if _, err := service.Resolve(ctx, first.Share.PublicID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("resolve revoked = %v", err)
	}

	regenerated, err := service.Create(ctx, owner, CreateInput{
		ResourceType: ResourceFile,
		ResourceID:   fileID,
	})
	if err != nil {
		t.Fatalf("regenerate share: %v", err)
	}
	if !regenerated.Created {
		t.Fatal("regenerated share was not created")
	}
	if regenerated.Share.ID == first.Share.ID || regenerated.Share.PublicID == first.Share.PublicID {
		t.Fatal("regenerate reused revoked share")
	}
	if _, err := service.Resolve(ctx, first.Share.PublicID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old public ID became active again: %v", err)
	}
}

func TestFolderTrashRevokesDescendantSharesIntegration(t *testing.T) {
	ctx, pool := openShareTestPool(t)
	userID, rootID := createShareUser(t, ctx, pool, "share-tree-owner")
	service := New(pool, collections.New(pool))
	actor := Actor{UserID: userID}

	var folderID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (
			kind, owner_user_id, parent_id, name, name_key, created_by
		)
		VALUES (
			'folder', $1::uuid, $2::uuid, 'Shared', 'shared', $1::uuid
		)
		RETURNING id::text
	`, userID, rootID).Scan(&folderID); err != nil {
		t.Fatalf("create folder: %v", err)
	}

	fileID := createShareFile(t, ctx, pool, userID, folderID, "nested.bin")

	folderShare, err := service.Create(ctx, actor, CreateInput{
		ResourceType: ResourceFolder,
		ResourceID:   folderID,
	})
	if err != nil {
		t.Fatalf("share folder: %v", err)
	}

	fileShare, err := service.Create(ctx, actor, CreateInput{
		ResourceType: ResourceFile,
		ResourceID:   fileID,
	})
	if err != nil {
		t.Fatalf("share file: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE nodes
		SET deleted_at = now(), deleted_by = $2::uuid
		WHERE id = $1::uuid
	`, folderID, userID); err != nil {
		t.Fatalf("trash folder: %v", err)
	}

	for _, publicID := range []string{
		folderShare.Share.PublicID,
		fileShare.Share.PublicID,
	} {
		if _, err := service.Resolve(ctx, publicID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("resolve after folder trash = %v", err)
		}
	}

	var active int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM public_shares
		WHERE revoked_at IS NULL
		  AND node_id IN ($1::uuid, $2::uuid)
	`, folderID, fileID).Scan(&active); err != nil {
		t.Fatalf("count active shares: %v", err)
	}
	if active != 0 {
		t.Fatalf("active descendant shares = %d, want 0", active)
	}
}

func TestCollectionTrashDoesNotReactivateOldShareIntegration(t *testing.T) {
	ctx, pool := openShareTestPool(t)
	userID, _ := createShareUser(t, ctx, pool, "share-collection-owner")

	collectionService := collections.New(pool)
	service := New(pool, collectionService)
	actor := Actor{UserID: userID}

	collection, err := collectionService.Create(
		ctx,
		collections.Actor{UserID: userID},
		"Public collection",
		"",
	)
	if err != nil {
		t.Fatalf("create collection: %v", err)
	}

	first, err := service.Create(ctx, actor, CreateInput{
		ResourceType: ResourceCollection,
		ResourceID:   collection.ID,
	})
	if err != nil {
		t.Fatalf("share collection: %v", err)
	}

	if err := collectionService.Trash(
		ctx,
		collections.Actor{UserID: userID},
		collection.ID,
	); err != nil {
		t.Fatalf("trash collection: %v", err)
	}

	if _, err := service.Resolve(ctx, first.Share.PublicID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("resolve trashed collection = %v", err)
	}

	if _, err := collectionService.Restore(
		ctx,
		collections.Actor{UserID: userID},
		collection.ID,
		"",
	); err != nil {
		t.Fatalf("restore collection: %v", err)
	}

	if _, err := service.Resolve(ctx, first.Share.PublicID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old share reactivated after restore = %v", err)
	}

	second, err := service.Create(ctx, actor, CreateInput{
		ResourceType: ResourceCollection,
		ResourceID:   collection.ID,
	})
	if err != nil {
		t.Fatalf("create new collection share: %v", err)
	}
	if second.Share.PublicID == first.Share.PublicID {
		t.Fatal("new collection share reused old public ID")
	}
}

func TestResolveHardBlocksEffectivelyDeletedNodeIntegration(t *testing.T) {
	ctx, pool := openShareTestPool(t)
	userID, rootID := createShareUser(t, ctx, pool, "share-hard-block-owner")
	service := New(pool, collections.New(pool))
	actor := Actor{UserID: userID}

	var folderID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (
			kind, owner_user_id, parent_id, name, name_key, created_by
		)
		VALUES (
			'folder', $1::uuid, $2::uuid, 'Private', 'private', $1::uuid
		)
		RETURNING id::text
	`, userID, rootID).Scan(&folderID); err != nil {
		t.Fatalf("create folder: %v", err)
	}

	fileID := createShareFile(t, ctx, pool, userID, folderID, "secret.bin")

	result, err := service.Create(ctx, actor, CreateInput{
		ResourceType: ResourceFile,
		ResourceID:   fileID,
	})
	if err != nil {
		t.Fatalf("create share: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE nodes
		SET deleted_at = now(), deleted_by = $2::uuid
		WHERE id = $1::uuid
	`, folderID, userID); err != nil {
		t.Fatalf("trash parent: %v", err)
	}

	// Simulate corrupted/stale share state. Resolver must still fail closed.
	if _, err := pool.Exec(ctx, `
		UPDATE public_shares
		SET revoked_at = NULL, revoked_by = NULL
		WHERE id = $1::uuid
	`, result.Share.ID); err != nil {
		t.Fatalf("force stale active share: %v", err)
	}

	if _, err := service.Resolve(ctx, result.Share.PublicID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("resolve effectively deleted file = %v", err)
	}
}

func openShareTestPool(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()

	dsn := os.Getenv("DISCLOUD_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("DISCLOUD_TEST_DATABASE_DSN is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)

	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		cancel()
		t.Fatalf("open admin pool: %v", err)
	}

	schema := fmt.Sprintf("discloud_share_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()

	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		admin.Close()
		cancel()
		t.Fatalf("create schema: %v", err)
	}

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse DSN: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("open isolated pool: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := migrate.Up(ctx, pool, migrations.FS, logger); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()

		cleanupCtx, cleanupCancel := context.WithTimeout(
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

func createShareUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string) (string, string) {
	t.Helper()

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash)
		VALUES ($1, 'test-hash')
		RETURNING id::text
	`, username).Scan(&userID); err != nil {
		t.Fatalf("create user %s: %v", username, err)
	}

	var rootID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (
			kind, owner_user_id, name, name_key, is_root, created_by
		)
		VALUES (
			'folder', $1::uuid, '', '', true, $1::uuid
		)
		RETURNING id::text
	`, userID).Scan(&rootID); err != nil {
		t.Fatalf("create root: %v", err)
	}

	return userID, rootID
}

func createShareFile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID, parentID, name string) string {
	t.Helper()

	var fileID string
	if err := pool.QueryRow(ctx, `
		WITH node AS (
			INSERT INTO nodes (
				kind, owner_user_id, parent_id, name, name_key, created_by
			)
			VALUES (
				'file', $1::uuid, $2::uuid, $3, lower($3), $1::uuid
			)
			RETURNING id
		)
		INSERT INTO files (
			node_id, size_bytes, chunk_size_bytes, mime_type
		)
		SELECT
			id, 1, 10, 'application/octet-stream'
		FROM node
		RETURNING node_id::text
	`, ownerID, parentID, name).Scan(&fileID); err != nil {
		t.Fatalf("create file %s: %v", name, err)
	}

	return fileID
}
