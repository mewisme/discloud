package uploads

import (
	"testing"
	"time"
)

func TestAdaptiveChunkPlanIsPersistedPerSession(t *testing.T) {
	ctx, pool := openUploadTestPool(t)

	ownerID, rootID := createUploadUser(
		t,
		ctx,
		pool,
		"adaptive-chunk-owner",
		nil,
	)

	provider := &testCapacityProvider{capacity: 8}
	service := NewWithCapacityProvider(
		pool,
		10*testMiB,
		time.Hour,
		provider,
	)

	created, err := service.Create(
		ctx,
		Actor{UserID: ownerID},
		CreateInput{
			ParentFolderID: rootID,
			Name:           "adaptive.bin",
			SizeBytes:      20 * testMiB,
		},
	)
	if err != nil {
		t.Fatalf("Create(): %v", err)
	}

	if created.ChunkSizeBytes != 2*testMiB {
		t.Fatalf(
			"created chunk size = %d, want %d",
			created.ChunkSizeBytes,
			2*testMiB,
		)
	}

	if created.ExpectedParts != 10 {
		t.Fatalf(
			"created expected parts = %d, want 10",
			created.ExpectedParts,
		)
	}

	provider.capacity = 1

	loaded, err := service.Get(
		ctx,
		Actor{UserID: ownerID},
		created.ID,
	)
	if err != nil {
		t.Fatalf("Get(): %v", err)
	}

	if loaded.ChunkSizeBytes != created.ChunkSizeBytes {
		t.Fatalf(
			"loaded chunk size = %d, created = %d",
			loaded.ChunkSizeBytes,
			created.ChunkSizeBytes,
		)
	}

	if loaded.ExpectedParts != created.ExpectedParts {
		t.Fatalf(
			"loaded expected parts = %d, created = %d",
			loaded.ExpectedParts,
			created.ExpectedParts,
		)
	}
}
