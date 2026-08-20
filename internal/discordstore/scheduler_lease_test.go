package discordstore

import (
	"context"
	"testing"
	"time"
)

func TestSchedulerAcquireSkipsBusyBots(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}, {UserID: "2"}})

	first, releaseFirst, err := scheduler.Acquire(context.Background(), nil)
	if err != nil {
		t.Fatalf("Acquire(first): %v", err)
	}
	defer releaseFirst()

	second, releaseSecond, err := scheduler.Acquire(context.Background(), nil)
	if err != nil {
		t.Fatalf("Acquire(second): %v", err)
	}
	defer releaseSecond()

	if first.UserID == second.UserID {
		t.Fatalf("busy bot reused: first=%s second=%s", first.UserID, second.UserID)
	}
}

func TestSchedulerAcquireWaitsForRelease(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})
	_, release, err := scheduler.Acquire(context.Background(), nil)
	if err != nil {
		t.Fatalf("Acquire(first): %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	result := make(chan string, 1)
	go func() {
		bot, nextRelease, err := scheduler.Acquire(ctx, nil)
		if err != nil {
			result <- "error"
			return
		}
		nextRelease()
		result <- bot.UserID
	}()

	select {
	case <-result:
		t.Fatal("Acquire returned before the busy bot was released")
	case <-time.After(20 * time.Millisecond):
	}

	release()

	select {
	case userID := <-result:
		if userID != "1" {
			t.Fatalf("bot = %s, want 1", userID)
		}
	case <-ctx.Done():
		t.Fatal("Acquire did not resume after release")
	}
}
