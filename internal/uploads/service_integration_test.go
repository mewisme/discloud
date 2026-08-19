package uploads

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

func TestUploadSessionQuotaIntegration(t *testing.T) {
	ctx, pool := openUploadTestPool(t)

	quota := int64(100)
	ownerID, rootID := createUploadUser(
		t,
		ctx,
		pool,
		"upload-owner",
		&quota,
	)
	editorID, _ := createUploadUser(
		t,
		ctx,
		pool,
		"upload-editor",
		nil,
	)
	viewerID, _ := createUploadUser(
		t,
		ctx,
		pool,
		"upload-viewer",
		nil,
	)

	var folderID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (
			kind,
			owner_user_id,
			parent_id,
			name,
			name_key,
			created_by
		)
		VALUES (
			'folder',
			$1,
			$2,
			'Shared',
			'shared',
			$1
		)
		RETURNING id::text
	`, ownerID, rootID).Scan(&folderID); err != nil {
		t.Fatalf("create folder: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO folder_permissions (
			folder_id,
			user_id,
			level,
			created_by
		)
		VALUES
			($1, $2, 'edit', $4),
			($1, $3, 'view', $4)
	`, folderID, editorID, viewerID, ownerID); err != nil {
		t.Fatalf("create grants: %v", err)
	}

	service := New(pool, 10, time.Hour)

	session, err := service.Create(
		ctx,
		Actor{UserID: editorID},
		CreateInput{
			ParentFolderID: folderID,
			Name:           "video.bin",
			SizeBytes:      25,
		},
	)
	if err != nil {
		t.Fatalf("create upload: %v", err)
	}

	if session.OwnerUserID != ownerID {
		t.Fatalf(
			"owner = %s, want %s",
			session.OwnerUserID,
			ownerID,
		)
	}
	if session.ActorUserID != editorID {
		t.Fatalf(
			"actor = %s, want %s",
			session.ActorUserID,
			editorID,
		)
	}
	if session.ExpectedParts != 3 {
		t.Fatalf(
			"parts = %d, want 3",
			session.ExpectedParts,
		)
	}

	assertReservedBytes(t, ctx, pool, ownerID, 25)

	_, err = service.Create(
		ctx,
		Actor{UserID: editorID},
		CreateInput{
			ParentFolderID: folderID,
			Name:           "too-large.bin",
			SizeBytes:      80,
		},
	)
	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("quota error = %v", err)
	}

	_, err = service.Create(
		ctx,
		Actor{UserID: viewerID},
		CreateInput{
			ParentFolderID: folderID,
			Name:           "denied.bin",
			SizeBytes:      1,
		},
	)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer create = %v", err)
	}

	cancelled, err := service.Cancel(
		ctx,
		Actor{UserID: editorID},
		session.ID,
	)
	if err != nil {
		t.Fatalf("cancel upload: %v", err)
	}
	if cancelled.Status != StatusCancelled {
		t.Fatalf(
			"status = %s, want cancelled",
			cancelled.Status,
		)
	}

	assertReservedBytes(t, ctx, pool, ownerID, 0)

	if _, err := service.Cancel(
		ctx,
		Actor{UserID: editorID},
		session.ID,
	); err != nil {
		t.Fatalf("idempotent cancel: %v", err)
	}

	assertReservedBytes(t, ctx, pool, ownerID, 0)

	expiring, err := service.Create(
		ctx,
		Actor{UserID: editorID},
		CreateInput{
			ParentFolderID: folderID,
			Name:           "expire.bin",
			SizeBytes:      80,
		},
	)
	if err != nil {
		t.Fatalf("create expiring upload: %v", err)
	}

	assertReservedBytes(t, ctx, pool, ownerID, 80)

	if _, err := pool.Exec(ctx, `
		UPDATE upload_sessions
		SET expires_at = now() - interval '1 minute'
		WHERE id = $1
	`, expiring.ID); err != nil {
		t.Fatalf("expire session clock: %v", err)
	}

	count, err := service.Expire(ctx, 10)
	if err != nil {
		t.Fatalf("expire uploads: %v", err)
	}
	if count != 1 {
		t.Fatalf("expired = %d, want 1", count)
	}

	assertReservedBytes(t, ctx, pool, ownerID, 0)

	expired, err := service.Get(
		ctx,
		Actor{UserID: editorID},
		expiring.ID,
	)
	if err != nil {
		t.Fatalf("get expired upload: %v", err)
	}
	if expired.Status != StatusExpired {
		t.Fatalf(
			"status = %s, want expired",
			expired.Status,
		)
	}

	zero, err := service.Create(
		ctx,
		Actor{UserID: editorID},
		CreateInput{
			ParentFolderID: folderID,
			Name:           "empty.txt",
			SizeBytes:      0,
		},
	)
	if err != nil {
		t.Fatalf("create empty upload: %v", err)
	}
	if zero.ExpectedParts != 0 {
		t.Fatalf(
			"empty parts = %d, want 0",
			zero.ExpectedParts,
		)
	}

	assertReservedBytes(t, ctx, pool, ownerID, 0)

	if _, err := pool.Exec(ctx, `
		INSERT INTO nodes (
			kind,
			owner_user_id,
			parent_id,
			name,
			name_key,
			created_by
		)
		VALUES (
			'folder',
			$1,
			$2,
			'Taken',
			'taken',
			$1
		)
	`, ownerID, folderID); err != nil {
		t.Fatalf("create conflicting node: %v", err)
	}

	_, err = service.Create(
		ctx,
		Actor{UserID: editorID},
		CreateInput{
			ParentFolderID: folderID,
			Name:           "TAKEN",
			SizeBytes:      1,
		},
	)
	if !errors.Is(err, ErrNameConflict) {
		t.Fatalf("name conflict = %v", err)
	}
}

func openUploadTestPool(
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
		"discloud_upload_test_%d",
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
			"DROP SCHEMA "+
				identifier+
				" CASCADE",
		)

		admin.Close()
		cancel()
	})

	return ctx, pool
}

func createUploadUser(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	username string,
	quota *int64,
) (string, string) {
	t.Helper()

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (
			username,
			password_hash,
			storage_quota_bytes
		)
		VALUES ($1, 'test-hash', $2)
		RETURNING id::text
	`, username, quota).Scan(&userID); err != nil {
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
		VALUES (
			'folder',
			$1,
			'',
			'',
			true,
			$1
		)
		RETURNING id::text
	`, userID).Scan(&rootID); err != nil {
		t.Fatalf("create root %s: %v", username, err)
	}

	return userID, rootID
}

func assertReservedBytes(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	userID string,
	want int64,
) {
	t.Helper()

	var got int64
	if err := pool.QueryRow(ctx, `
		SELECT storage_reserved_bytes
		FROM users
		WHERE id::text = $1
	`, userID).Scan(&got); err != nil {
		t.Fatalf("read reserved bytes: %v", err)
	}

	if got != want {
		t.Fatalf(
			"reserved = %d, want %d",
			got,
			want,
		)
	}
}
