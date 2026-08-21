package discordstore

import (
	"testing"
	"time"
)

func TestStoreRecommendedPartConcurrencyUsesEffectiveCapacity(t *testing.T) {
	store := &Store{
		scheduler: NewScheduler([]Bot{
			{UserID: "1"},
			{UserID: "2"},
			{UserID: "3"},
		}),
	}

	if got := store.RecommendedPartConcurrency(); got != 3 {
		t.Fatalf("RecommendedPartConcurrency() = %d, want 3", got)
	}

	if err := store.scheduler.Disable("1"); err != nil {
		t.Fatalf("Disable(): %v", err)
	}

	if got := store.RecommendedPartConcurrency(); got != 2 {
		t.Fatalf("RecommendedPartConcurrency() after disable = %d, want 2", got)
	}

	store.scheduler.Cooldown("2", time.Minute)

	if got := store.RecommendedPartConcurrency(); got != 1 {
		t.Fatalf("RecommendedPartConcurrency() during cooldown = %d, want 1", got)
	}

	if err := store.scheduler.Disable("3"); err != nil {
		t.Fatalf("Disable(): %v", err)
	}

	if got := store.RecommendedPartConcurrency(); got != 1 {
		t.Fatalf("RecommendedPartConcurrency() with zero effective bots = %d, want fallback 1", got)
	}
}
