package discordstore

import (
	"testing"
	"time"
)

func TestStoreEffectiveCapacity(t *testing.T) {
	store := &Store{
		scheduler: NewScheduler([]Bot{
			{UserID: "1"},
			{UserID: "2"},
			{UserID: "3"},
		}),
	}

	if got := store.EffectiveCapacity(); got != 3 {
		t.Fatalf("EffectiveCapacity() = %d, want 3", got)
	}

	if err := store.scheduler.Disable("1"); err != nil {
		t.Fatalf("Disable(): %v", err)
	}

	if got := store.EffectiveCapacity(); got != 2 {
		t.Fatalf("EffectiveCapacity() after disable = %d, want 2", got)
	}

	store.scheduler.Cooldown("2", time.Minute)

	if got := store.EffectiveCapacity(); got != 1 {
		t.Fatalf("EffectiveCapacity() during cooldown = %d, want 1", got)
	}

	if err := store.scheduler.Disable("3"); err != nil {
		t.Fatalf("Disable(): %v", err)
	}

	if got := store.EffectiveCapacity(); got != 0 {
		t.Fatalf("EffectiveCapacity() with no usable bots = %d, want 0", got)
	}
}

func TestStoreRecommendedPartConcurrencyClampsToOne(t *testing.T) {
	store := &Store{
		scheduler: NewScheduler([]Bot{{UserID: "1"}}),
	}

	if err := store.scheduler.Disable("1"); err != nil {
		t.Fatalf("Disable(): %v", err)
	}

	if got := store.RecommendedPartConcurrency(); got != 1 {
		t.Fatalf("RecommendedPartConcurrency() = %d, want 1", got)
	}
}
