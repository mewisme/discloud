package discordstore

import (
	"context"
	"testing"
	"time"
)

func TestSchedulerCapacity(t *testing.T) {
	scheduler := NewScheduler([]Bot{
		{UserID: "1"},
		{UserID: "2"},
		{UserID: "3"},
	})

	got := scheduler.Capacity()
	want := SchedulerCapacity{
		Configured: 3,
		Effective:  3,
		Available:  3,
	}

	if got != want {
		t.Fatalf("Capacity() = %+v, want %+v", got, want)
	}
}

func TestSchedulerCapacityCountsBusyBotAsEffective(t *testing.T) {
	scheduler := NewScheduler([]Bot{
		{UserID: "1"},
		{UserID: "2"},
	})

	_, release, err := scheduler.Acquire(context.Background(), nil)
	if err != nil {
		t.Fatalf("Acquire(): %v", err)
	}
	defer release()

	got := scheduler.Capacity()
	want := SchedulerCapacity{
		Configured: 2,
		Effective:  2,
		Available:  1,
	}

	if got != want {
		t.Fatalf("Capacity() = %+v, want %+v", got, want)
	}
}

func TestSchedulerCapacityExcludesCooldown(t *testing.T) {
	now := time.Unix(1000, 0)
	scheduler := newSchedulerWithClock(
		[]Bot{
			{UserID: "1"},
			{UserID: "2"},
			{UserID: "3"},
		},
		func() time.Time { return now },
	)

	_, release, err := scheduler.Acquire(context.Background(), nil)
	if err != nil {
		t.Fatalf("Acquire(): %v", err)
	}
	defer release()

	scheduler.Cooldown("2", time.Minute)

	got := scheduler.Capacity()
	want := SchedulerCapacity{
		Configured: 3,
		Effective:  2,
		Available:  1,
	}

	if got != want {
		t.Fatalf("Capacity() during cooldown = %+v, want %+v", got, want)
	}

	now = now.Add(time.Minute)

	got = scheduler.Capacity()
	want = SchedulerCapacity{
		Configured: 3,
		Effective:  3,
		Available:  2,
	}

	if got != want {
		t.Fatalf("Capacity() after cooldown = %+v, want %+v", got, want)
	}
}

func TestSchedulerCapacityRestoresAvailabilityAfterRelease(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	_, release, err := scheduler.Acquire(context.Background(), nil)
	if err != nil {
		t.Fatalf("Acquire(): %v", err)
	}

	if got := scheduler.Capacity(); got.Available != 0 {
		t.Fatalf("Available while leased = %d, want 0", got.Available)
	}

	release()

	got := scheduler.Capacity()
	want := SchedulerCapacity{
		Configured: 1,
		Effective:  1,
		Available:  1,
	}

	if got != want {
		t.Fatalf("Capacity() after release = %+v, want %+v", got, want)
	}
}
