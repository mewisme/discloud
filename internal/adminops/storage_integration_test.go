package adminops

import (
	"context"
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

func TestStorageOverviewAndQuotaReconcileIntegration(t *testing.T) {
	ctx, pool := openOpsTestPool(t)
	service := New(pool)

	ownerID, rootID := createOpsUser(t, ctx, pool, "ops-owner")
	otherID, _ := createOpsUser(t, ctx, pool, "ops-other")

	createOpsFile(t, ctx, pool, ownerID, rootID, "active.bin", 40)

	var deletedFolderID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (
			kind, owner_user_id, parent_id, name, name_key, created_by
		)
		VALUES ('folder', $1::uuid, $2::uuid, 'Trash', 'trash', $1::uuid)
		RETURNING id::text
	`, ownerID, rootID).Scan(&deletedFolderID); err != nil {
		t.Fatalf("create deleted folder: %v", err)
	}
	createOpsFile(t, ctx, pool, ownerID, deletedFolderID, "hidden.bin", 60)

	if _, err := pool.Exec(ctx, `
		UPDATE nodes
		SET deleted_at = now(), deleted_by = $2::uuid
		WHERE id = $1::uuid
	`, deletedFolderID, ownerID); err != nil {
		t.Fatalf("trash folder: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO upload_sessions (
			actor_user_id, owner_user_id, parent_folder_id,
			name, name_key, size_bytes, chunk_size_bytes,
			expected_parts, reserved_bytes, status, expires_at
		)
		VALUES (
			$1::uuid, $1::uuid, $2::uuid,
			'pending.bin', 'pending.bin', 25, 10,
			3, 25, 'open', now() + interval '1 hour'
		)
	`, ownerID, rootID); err != nil {
		t.Fatalf("create reservation: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE users
		SET storage_used_bytes = 1, storage_reserved_bytes = 2
		WHERE id = $1::uuid
	`, ownerID); err != nil {
		t.Fatalf("corrupt owner counters: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE users
		SET storage_used_bytes = 7, storage_reserved_bytes = 8
		WHERE id = $1::uuid
	`, otherID); err != nil {
		t.Fatalf("corrupt other counters: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO chunks (
			sha256, size_bytes, discord_channel_id,
			discord_message_id, discord_attachment_id,
			status, committed_at
		)
		VALUES (
			decode(repeat('01', 32), 'hex'), 10, '1', '101', '201',
			'ready', now()
		), (
			decode(repeat('02', 32), 'hex'), 20, '1', '102', '202',
			'uncommitted', NULL
		)
	`); err != nil {
		t.Fatalf("create chunks: %v", err)
	}

	overview, err := service.Overview(ctx)
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	if overview.DerivedLogicalUsedBytes != 40 {
		t.Fatalf("derived used = %d, want 40", overview.DerivedLogicalUsedBytes)
	}
	if overview.DerivedReservedBytes != 25 {
		t.Fatalf("derived reserved = %d, want 25", overview.DerivedReservedBytes)
	}
	if overview.UniqueChunkBytes != 30 || overview.OrphanCandidateChunkBytes != 20 {
		t.Fatalf("chunk overview = %+v", overview)
	}
	if overview.QuotaMismatchUsers != 2 {
		t.Fatalf("mismatched users = %d, want 2", overview.QuotaMismatchUsers)
	}

	result, err := service.ReconcileQuota(ctx, ownerID, ownerID)
	if err != nil {
		t.Fatalf("reconcile owner: %v", err)
	}
	if len(result) != 1 || result[0].AfterUsedBytes != 40 || result[0].AfterReservedBytes != 25 {
		t.Fatalf("owner reconciliation = %+v", result)
	}

	var otherUsed, otherReserved int64
	if err := pool.QueryRow(ctx, `
		SELECT storage_used_bytes, storage_reserved_bytes
		FROM users
		WHERE id = $1::uuid
	`, otherID).Scan(&otherUsed, &otherReserved); err != nil {
		t.Fatalf("read other counters: %v", err)
	}
	if otherUsed != 7 || otherReserved != 8 {
		t.Fatalf("targeted reconcile changed other user: %d/%d", otherUsed, otherReserved)
	}

	result, err = service.ReconcileQuota(ctx, ownerID, "")
	if err != nil {
		t.Fatalf("reconcile all: %v", err)
	}
	if len(result) != 2 {
		t.Fatalf("all reconciliation count = %d", len(result))
	}

	if err := pool.QueryRow(ctx, `
		SELECT storage_used_bytes, storage_reserved_bytes
		FROM users
		WHERE id = $1::uuid
	`, otherID).Scan(&otherUsed, &otherReserved); err != nil {
		t.Fatalf("read reconciled other counters: %v", err)
	}
	if otherUsed != 0 || otherReserved != 0 {
		t.Fatalf("other counters = %d/%d, want 0/0", otherUsed, otherReserved)
	}

	var audits int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM audit_events
		WHERE action = 'storage.quota_reconcile'
		  AND actor_user_id = $1::uuid
	`, ownerID).Scan(&audits); err != nil {
		t.Fatalf("count reconcile audits: %v", err)
	}
	if audits != 2 {
		t.Fatalf("reconcile audits = %d, want 2", audits)
	}
}

func TestAdminDiagnosticQueriesIntegration(t *testing.T) {
	ctx, pool := openOpsTestPool(t)
	service := New(pool)

	userID, rootID := createOpsUser(t, ctx, pool, "ops-diagnostics")

	if _, err := pool.Exec(ctx, `
		INSERT INTO audit_events (
			actor_user_id, action, resource_type, resource_id, metadata
		)
		VALUES ($1::uuid, 'test.action', 'user', $1::uuid, '{"ok":true}')
	`, userID); err != nil {
		t.Fatalf("create audit event: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO jobs (
			type, status, payload, attempts, max_attempts, last_error
		)
		VALUES (
			'test.job', 'dead', '{"fileId":"abc"}', 5, 5, 'upstream unavailable'
		)
	`); err != nil {
		t.Fatalf("create job: %v", err)
	}

	var uploadID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO upload_sessions (
			actor_user_id, owner_user_id, parent_folder_id,
			name, name_key, size_bytes, chunk_size_bytes,
			expected_parts, reserved_bytes, status, expires_at
		)
		VALUES (
			$1::uuid, $1::uuid, $2::uuid,
			'failed.bin', 'failed.bin', 10, 10,
			1, 0, 'failed', now() + interval '1 hour'
		)
		RETURNING id::text
	`, userID, rootID).Scan(&uploadID); err != nil {
		t.Fatalf("create failed upload: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO chunk_upload_attempts (
			upload_session_id, part_number, attempt_number,
			discord_bot_user_id, status, error_class,
			error_message, finished_at
		)
		VALUES (
			$1::uuid, 0, 1, '123', 'failed',
			'unavailable', 'Discord unavailable', now()
		)
	`, uploadID); err != nil {
		t.Fatalf("create upload attempt: %v", err)
	}

	audits, _, err := service.ListAudit(ctx, AuditQuery{
		Action: "test.action",
		Limit:  50,
	})
	if err != nil || len(audits) != 1 {
		t.Fatalf("audit diagnostics = %+v, %v", audits, err)
	}

	jobs, _, err := service.ListJobs(ctx, JobQuery{
		Status: "dead",
		Limit:  50,
	})
	if err != nil || len(jobs) != 1 || jobs[0].LastError == "" {
		t.Fatalf("job diagnostics = %+v, %v", jobs, err)
	}

	uploads, _, err := service.ListUploads(ctx, UploadQuery{
		Status: "failed",
		Limit:  50,
	})
	if err != nil || len(uploads) != 1 {
		t.Fatalf("upload diagnostics = %+v, %v", uploads, err)
	}
	if uploads[0].FailedAttempts != 1 ||
		uploads[0].LastErrorClass != "unavailable" ||
		uploads[0].LastErrorMessage != "Discord unavailable" {
		t.Fatalf("upload failure diagnostics = %+v", uploads[0])
	}
}

func openOpsTestPool(t *testing.T) (context.Context, *pgxpool.Pool) {
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

	schema := fmt.Sprintf("discloud_ops_test_%d", time.Now().UnixNano())
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
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = admin.Exec(cleanupCtx, "DROP SCHEMA "+identifier+" CASCADE")
		admin.Close()
		cancel()
	})

	return ctx, pool
}

func createOpsUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string) (string, string) {
	t.Helper()

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, 'test-hash', 'admin')
		RETURNING id::text
	`, username).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}

	var rootID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (
			kind, owner_user_id, name, name_key, is_root, created_by
		)
		VALUES ('folder', $1::uuid, '', '', true, $1::uuid)
		RETURNING id::text
	`, userID).Scan(&rootID); err != nil {
		t.Fatalf("create root: %v", err)
	}

	return userID, rootID
}

func createOpsFile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID, parentID, name string, size int64) string {
	t.Helper()

	var fileID string
	if err := pool.QueryRow(ctx, `
		WITH node AS (
			INSERT INTO nodes (
				kind, owner_user_id, parent_id, name, name_key, created_by
			)
			VALUES ('file', $1::uuid, $2::uuid, $3, lower($3), $1::uuid)
			RETURNING id
		)
		INSERT INTO files (
			node_id, size_bytes, chunk_size_bytes, mime_type
		)
		SELECT id, $4, 10, 'application/octet-stream'
		FROM node
		RETURNING node_id::text
	`, ownerID, parentID, name, size).Scan(&fileID); err != nil {
		t.Fatalf("create file: %v", err)
	}
	return fileID
}
