package adminops

import "testing"

func TestQuotaReconciliationIncludesUserIdentityIntegration(t *testing.T) {
	ctx, pool := openOpsTestPool(t)
	service := New(pool)

	actorID, _ := createOpsUser(t, ctx, pool, "quota-admin")
	userID, rootID := createOpsUser(t, ctx, pool, "quota-user")

	if _, err := pool.Exec(ctx, `
		UPDATE users
		SET name = CASE
			WHEN id = $1::uuid THEN 'Quota Admin'
			WHEN id = $2::uuid THEN 'Quota User'
			ELSE name
		END
		WHERE id IN ($1::uuid, $2::uuid)
	`, actorID, userID); err != nil {
		t.Fatalf("set user names: %v", err)
	}

	createOpsFile(t, ctx, pool, userID, rootID, "quota.bin", 40)

	if _, err := pool.Exec(ctx, `
		UPDATE users
		SET storage_used_bytes = 1, storage_reserved_bytes = 2
		WHERE id = $1::uuid
	`, userID); err != nil {
		t.Fatalf("corrupt quota counters: %v", err)
	}

	result, err := service.ReconcileQuota(ctx, actorID, userID)
	if err != nil {
		t.Fatalf("reconcile quota: %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("result count = %d, want 1", len(result))
	}

	item := result[0]
	if item.UserID != userID {
		t.Fatalf("user ID = %q, want %q", item.UserID, userID)
	}
	if item.Username != "quota-user" {
		t.Fatalf("username = %q, want quota-user", item.Username)
	}
	if item.Name != "Quota User" {
		t.Fatalf("name = %q, want Quota User", item.Name)
	}
	if item.BeforeUsedBytes != 1 {
		t.Fatalf("before used = %d, want 1", item.BeforeUsedBytes)
	}
	if item.AfterUsedBytes != 40 {
		t.Fatalf("after used = %d, want 40", item.AfterUsedBytes)
	}
	if item.BeforeReservedBytes != 2 {
		t.Fatalf("before reserved = %d, want 2", item.BeforeReservedBytes)
	}
	if item.AfterReservedBytes != 0 {
		t.Fatalf("after reserved = %d, want 0", item.AfterReservedBytes)
	}
	if !item.Changed {
		t.Fatal("reconciliation should report changed")
	}
}
