package adminusers

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

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestAdminUserLifecycleIntegration(t *testing.T) {
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

	schema := fmt.Sprintf("discloud_admin_users_test_%d", time.Now().UnixNano())
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

	adminHash, err := auth.HashPassword("admin-correct-horse-password")
	if err != nil {
		t.Fatalf("hash admin password: %v", err)
	}

	var adminID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, name, password_hash, role)
		VALUES ('admin', 'Admin', $1, 'admin')
		RETURNING id::text
	`, adminHash).Scan(&adminID); err != nil {
		t.Fatalf("create admin: %v", err)
	}

	service := New(pool)
	quota := int64(1024)

	userRole := "user"
	if _, err := service.Update(ctx, adminID, adminID, UpdateInput{Role: &userRole}); !errors.Is(err, ErrLastActiveAdmin) {
		t.Fatalf("demote last active admin = %v, want ErrLastActiveAdmin", err)
	}
	if err := service.Disable(ctx, adminID, adminID); !errors.Is(err, ErrLastActiveAdmin) {
		t.Fatalf("disable last active admin = %v, want ErrLastActiveAdmin", err)
	}

	secondAdmin, err := service.Create(ctx, adminID, CreateInput{Name: "Second Admin", Username: "second-admin", Password: "temp-admin", Role: "admin"})
	if err != nil {
		t.Fatalf("create second admin: %v", err)
	}
	if err := service.Disable(ctx, secondAdmin.ID, adminID); err != nil {
		t.Fatalf("disable admin with another active admin: %v", err)
	}
	if err := service.Disable(ctx, secondAdmin.ID, secondAdmin.ID); !errors.Is(err, ErrLastActiveAdmin) {
		t.Fatalf("disable remaining active admin = %v, want ErrLastActiveAdmin", err)
	}
	if err := service.Enable(ctx, secondAdmin.ID, adminID); err != nil {
		t.Fatalf("re-enable admin: %v", err)
	}

	results := make(chan error, 2)
	go func() {
		_, err := service.Update(ctx, secondAdmin.ID, adminID, UpdateInput{Role: &userRole})
		results <- err
	}()
	go func() {
		_, err := service.Update(ctx, adminID, secondAdmin.ID, UpdateInput{Role: &userRole})
		results <- err
	}()
	succeeded, rejected := 0, 0
	for range 2 {
		err := <-results
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, ErrLastActiveAdmin):
			rejected++
		default:
			t.Fatalf("concurrent admin demotion: %v", err)
		}
	}
	if succeeded != 1 || rejected != 1 {
		t.Fatalf("concurrent admin demotion succeeded=%d rejected=%d, want 1/1", succeeded, rejected)
	}
	adminRole := "admin"
	if _, err := service.Update(ctx, adminID, adminID, UpdateInput{Role: &adminRole}); err != nil {
		t.Fatalf("restore first admin role: %v", err)
	}
	if _, err := service.Update(ctx, adminID, secondAdmin.ID, UpdateInput{Role: &adminRole}); err != nil {
		t.Fatalf("restore second admin role: %v", err)
	}

	user, err := service.Create(ctx, adminID, CreateInput{
		Name:              "Alice Example",
		Username:          "alice",
		Password:          "temp-alice",
		StorageQuotaBytes: &quota,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	if user.Name != "Alice Example" {
		t.Fatalf("name = %q, want Alice Example", user.Name)
	}
	if user.Username != "alice" {
		t.Fatalf("username = %q, want alice", user.Username)
	}
	if user.Role != "user" {
		t.Fatalf("role = %q, want user", user.Role)
	}
	if !user.MustChangePassword {
		t.Fatal("admin-created user should change password")
	}
	if user.HasAvatar {
		t.Fatal("new user unexpectedly has avatar")
	}
	if user.AvatarRevision != 0 {
		t.Fatalf("avatar revision = %d, want 0", user.AvatarRevision)
	}

	createdPasswordHash := ""
	if err := pool.QueryRow(ctx, `
		SELECT password_hash
		FROM users
		WHERE id::text = $1
	`, user.ID).Scan(&createdPasswordHash); err != nil {
		t.Fatalf("read created password hash: %v", err)
	}

	match, err := auth.VerifyPassword("temp-alice", createdPasswordHash)
	if err != nil {
		t.Fatalf("verify created temporary password: %v", err)
	}
	if !match {
		t.Fatal("created temporary password did not match")
	}

	if _, err := service.Create(ctx, adminID, CreateInput{
		Name:     "Empty Password",
		Username: "empty-password",
		Password: "",
	}); !errors.Is(err, auth.ErrInvalidTemporaryPassword) {
		t.Fatalf("empty temporary password = %v, want ErrInvalidTemporaryPassword", err)
	}

	got, err := service.Get(ctx, user.ID)
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	if got.Name != "Alice Example" {
		t.Fatalf("get name = %q, want Alice Example", got.Name)
	}
	if got.Username != "alice" {
		t.Fatalf("get username = %q, want alice", got.Username)
	}
	if got.HasAvatar {
		t.Fatal("get user unexpectedly has avatar")
	}
	if got.AvatarRevision != 0 {
		t.Fatalf("get avatar revision = %d, want 0", got.AvatarRevision)
	}

	listed, err := service.List(ctx, 50, 0)
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	if listed.Total != 3 {
		t.Fatalf("total users = %d, want 3", listed.Total)
	}

	var listedUser *User
	for i := range listed.Users {
		if listed.Users[i].ID == user.ID {
			listedUser = &listed.Users[i]
			break
		}
	}
	if listedUser == nil {
		t.Fatal("created user not found in user list")
	}
	if listedUser.Name != "Alice Example" {
		t.Fatalf("listed name = %q, want Alice Example", listedUser.Name)
	}
	if listedUser.Username != "alice" {
		t.Fatalf("listed username = %q, want alice", listedUser.Username)
	}
	if listedUser.HasAvatar {
		t.Fatal("listed user unexpectedly has avatar")
	}
	if listedUser.AvatarRevision != 0 {
		t.Fatalf("listed avatar revision = %d, want 0", listedUser.AvatarRevision)
	}

	root, err := service.Root(ctx, user.ID)
	if err != nil {
		t.Fatalf("get root: %v", err)
	}
	if root.ID == "" {
		t.Fatal("root ID is empty")
	}

	usage, err := service.Usage(ctx, user.ID)
	if err != nil {
		t.Fatalf("get usage: %v", err)
	}
	if usage.QuotaBytes == nil || *usage.QuotaBytes != quota {
		t.Fatalf("quota = %v, want %d", usage.QuotaBytes, quota)
	}
	if usage.AvailableBytes == nil || *usage.AvailableBytes != quota {
		t.Fatalf("available = %v, want %d", usage.AvailableBytes, quota)
	}

	if _, err := service.Create(ctx, adminID, CreateInput{
		Name:     "Another Alice",
		Username: "Alice",
		Password: "temp-alice",
	}); !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("duplicate username = %v, want ErrUsernameTaken", err)
	}

	updatedName := "Alice Updated"
	updated, err := service.Update(ctx, adminID, user.ID, UpdateInput{Name: &updatedName})
	if err != nil {
		t.Fatalf("update user: %v", err)
	}
	if updated.Name != "Alice Updated" {
		t.Fatalf("name = %q, want Alice Updated", updated.Name)
	}
	if updated.Username != "alice" {
		t.Fatalf("username = %q, want alice", updated.Username)
	}
	if updated.HasAvatar {
		t.Fatal("updated user unexpectedly has avatar")
	}
	if updated.AvatarRevision != 0 {
		t.Fatalf("updated avatar revision = %d, want 0", updated.AvatarRevision)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, decode('01', 'hex'), now() + interval '1 hour')
	`, user.ID); err != nil {
		t.Fatalf("create session: %v", err)
	}

	if err := service.Disable(ctx, adminID, user.ID); err != nil {
		t.Fatalf("disable user: %v", err)
	}

	var activeSessions int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM sessions
		WHERE user_id::text = $1
		  AND revoked_at IS NULL
	`, user.ID).Scan(&activeSessions); err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if activeSessions != 0 {
		t.Fatalf("active sessions = %d, want 0", activeSessions)
	}

	if err := service.Enable(ctx, adminID, user.ID); err != nil {
		t.Fatalf("enable user: %v", err)
	}

	if err := service.SetQuota(ctx, adminID, user.ID, nil); err != nil {
		t.Fatalf("set unlimited quota: %v", err)
	}

	usage, err = service.Usage(ctx, user.ID)
	if err != nil {
		t.Fatalf("get unlimited usage: %v", err)
	}
	if usage.QuotaBytes != nil || usage.AvailableBytes != nil {
		t.Fatalf("unlimited usage = %+v", usage)
	}

	if err := service.ResetPassword(ctx, adminID, user.ID, ""); !errors.Is(err, auth.ErrInvalidTemporaryPassword) {
		t.Fatalf("empty reset password = %v, want ErrInvalidTemporaryPassword", err)
	}

	if err := service.ResetPassword(ctx, adminID, user.ID, "temp-reset"); err != nil {
		t.Fatalf("reset password: %v", err)
	}

	var resetPasswordHash string
	var mustChange bool
	if err := pool.QueryRow(ctx, `
		SELECT password_hash, must_change_password
		FROM users
		WHERE id::text = $1
	`, user.ID).Scan(&resetPasswordHash, &mustChange); err != nil {
		t.Fatalf("read reset password state: %v", err)
	}
	if !mustChange {
		t.Fatal("must_change_password is false after admin reset")
	}

	match, err = auth.VerifyPassword("temp-reset", resetPasswordHash)
	if err != nil {
		t.Fatalf("verify reset temporary password: %v", err)
	}
	if !match {
		t.Fatal("reset temporary password did not match")
	}

	var auditCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM audit_events
		WHERE actor_user_id::text = $1
		  AND resource_id::text = $2
	`, adminID, user.ID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit events: %v", err)
	}
	if auditCount < 5 {
		t.Fatalf("audit events = %d, want at least 5", auditCount)
	}
}
