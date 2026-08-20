package uploads

import (
	"errors"
	"testing"
	"time"
)

func TestCreateUploadClassifiesExistingFileConflict(t *testing.T) {
	ctx, pool := openUploadTestPool(t)
	ownerID, rootID := createUploadUser(t, ctx, pool, "existing-file-owner", nil)

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
			'file',
			$1::uuid,
			$2::uuid,
			'Existing.txt',
			'existing.txt',
			$1::uuid
		)
	`, ownerID, rootID); err != nil {
		t.Fatalf("create existing file node: %v", err)
	}

	service := New(pool, 10, time.Hour)
	_, err := service.Create(ctx, Actor{UserID: ownerID}, CreateInput{
		ParentFolderID: rootID,
		Name:           "EXISTING.TXT",
		SizeBytes:      10,
	})
	if !errors.Is(err, ErrFileAlreadyExists) {
		t.Fatalf("existing file conflict = %v, want ErrFileAlreadyExists", err)
	}
	if !errors.Is(err, ErrNameConflict) {
		t.Fatalf("existing file conflict must remain a name conflict: %v", err)
	}
}
