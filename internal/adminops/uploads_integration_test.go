package adminops

import (
	"testing"
)

func TestUploadDiagnosticsIncludeUserIdentityIntegration(t *testing.T) {
	ctx, pool := openOpsTestPool(t)
	service := New(pool)

	actorID, _ := createOpsUser(t, ctx, pool, "ops-upload-actor")
	ownerID, rootID := createOpsUser(t, ctx, pool, "ops-upload-owner")

	if _, err := pool.Exec(ctx, `
		UPDATE users
		SET name = CASE
			WHEN id = $1::uuid THEN 'Upload Actor'
			WHEN id = $2::uuid THEN 'Upload Owner'
			ELSE name
		END
		WHERE id IN ($1::uuid, $2::uuid)
	`, actorID, ownerID); err != nil {
		t.Fatalf("set diagnostic user names: %v", err)
	}

	var uploadID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO upload_sessions (
			actor_user_id,
			owner_user_id,
			parent_folder_id,
			name,
			name_key,
			size_bytes,
			chunk_size_bytes,
			expected_parts,
			reserved_bytes,
			status,
			expires_at
		)
		VALUES (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			'identity.bin',
			'identity.bin',
			10,
			10,
			1,
			10,
			'open',
			now() + interval '1 hour'
		)
		RETURNING id::text
	`, actorID, ownerID, rootID).Scan(&uploadID); err != nil {
		t.Fatalf("create upload: %v", err)
	}

	uploads, hasMore, err := service.ListUploads(ctx, UploadQuery{
		Status:      "open",
		OwnerUserID: ownerID,
		ActorUserID: actorID,
		Limit:       50,
	})
	if err != nil {
		t.Fatalf("list uploads: %v", err)
	}
	if hasMore {
		t.Fatal("unexpected additional upload diagnostics")
	}
	if len(uploads) != 1 {
		t.Fatalf("uploads = %d, want 1", len(uploads))
	}

	upload := uploads[0]
	if upload.ID != uploadID {
		t.Fatalf("upload ID = %q, want %q", upload.ID, uploadID)
	}
	if upload.ActorUserID != actorID {
		t.Fatalf("actor ID = %q, want %q", upload.ActorUserID, actorID)
	}
	if upload.ActorUsername != "ops-upload-actor" {
		t.Fatalf("actor username = %q, want ops-upload-actor", upload.ActorUsername)
	}
	if upload.ActorName != "Upload Actor" {
		t.Fatalf("actor name = %q, want Upload Actor", upload.ActorName)
	}
	if upload.OwnerUserID != ownerID {
		t.Fatalf("owner ID = %q, want %q", upload.OwnerUserID, ownerID)
	}
	if upload.OwnerUsername != "ops-upload-owner" {
		t.Fatalf("owner username = %q, want ops-upload-owner", upload.OwnerUsername)
	}
	if upload.OwnerName != "Upload Owner" {
		t.Fatalf("owner name = %q, want Upload Owner", upload.OwnerName)
	}
}
