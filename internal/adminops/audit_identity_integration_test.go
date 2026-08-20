package adminops

import "testing"

func TestAuditDiagnosticsIncludeResourceUserIdentityIntegration(t *testing.T) {
	ctx, pool := openOpsTestPool(t)
	service := New(pool)

	actorID, _ := createOpsUser(t, ctx, pool, "audit-actor")
	resourceID, _ := createOpsUser(t, ctx, pool, "audit-resource")

	if _, err := pool.Exec(ctx, `
		UPDATE users
		SET name = CASE
			WHEN id = $1::uuid THEN 'Audit Actor'
			WHEN id = $2::uuid THEN 'Audit Resource'
			ELSE name
		END
		WHERE id IN ($1::uuid, $2::uuid)
	`, actorID, resourceID); err != nil {
		t.Fatalf("set audit user names: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO audit_events (
			actor_user_id,
			action,
			resource_type,
			resource_id,
			metadata
		)
		VALUES ($1::uuid, 'test.user-resource', 'user', $2::uuid, '{}')
	`, actorID, resourceID); err != nil {
		t.Fatalf("create user resource audit: %v", err)
	}

	events, hasMore, err := service.ListAudit(ctx, AuditQuery{
		Action: "test.user-resource",
		Limit:  50,
	})
	if err != nil {
		t.Fatalf("list user resource audits: %v", err)
	}
	if hasMore {
		t.Fatal("unexpected additional audit events")
	}
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}

	event := events[0]
	if event.ActorUserID != actorID {
		t.Fatalf("actor ID = %q, want %q", event.ActorUserID, actorID)
	}
	if event.ActorUsername != "audit-actor" {
		t.Fatalf("actor username = %q, want audit-actor", event.ActorUsername)
	}
	if event.ActorName != "Audit Actor" {
		t.Fatalf("actor name = %q, want Audit Actor", event.ActorName)
	}
	if event.ResourceID != resourceID {
		t.Fatalf("resource ID = %q, want %q", event.ResourceID, resourceID)
	}
	if event.ResourceUsername != "audit-resource" {
		t.Fatalf("resource username = %q, want audit-resource", event.ResourceUsername)
	}
	if event.ResourceName != "Audit Resource" {
		t.Fatalf("resource name = %q, want Audit Resource", event.ResourceName)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO audit_events (
			actor_user_id,
			action,
			resource_type,
			resource_id,
			metadata
		)
		VALUES ($1::uuid, 'test.non-user-resource', 'storage', $2::uuid, '{}')
	`, actorID, resourceID); err != nil {
		t.Fatalf("create non-user resource audit: %v", err)
	}

	events, _, err = service.ListAudit(ctx, AuditQuery{
		Action: "test.non-user-resource",
		Limit:  50,
	})
	if err != nil {
		t.Fatalf("list non-user resource audits: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("non-user events = %d, want 1", len(events))
	}
	if events[0].ResourceUsername != "" || events[0].ResourceName != "" {
		t.Fatalf("non-user resource unexpectedly resolved as user: %+v", events[0])
	}
}
