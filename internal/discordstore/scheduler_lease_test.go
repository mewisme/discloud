package discordstore

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
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

func TestSchedulerAcquireRespectsExclusions(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}, {UserID: "2"}, {UserID: "3"}})

	bot, release, err := scheduler.Acquire(context.Background(), []string{"1", "2"})
	if err != nil {
		t.Fatalf("Acquire(): %v", err)
	}
	defer release()

	if bot.UserID != "3" {
		t.Fatalf("bot = %s, want 3", bot.UserID)
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

func TestSchedulerReleaseIsIdempotent(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	bot, release, err := scheduler.Acquire(context.Background(), nil)
	if err != nil {
		t.Fatalf("Acquire(first): %v", err)
	}
	if bot.UserID != "1" {
		t.Fatalf("bot = %s, want 1", bot.UserID)
	}

	release()
	release()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	next, nextRelease, err := scheduler.Acquire(ctx, nil)
	if err != nil {
		t.Fatalf("Acquire(after duplicate release): %v", err)
	}
	defer nextRelease()

	if next.UserID != "1" {
		t.Fatalf("bot = %s, want 1", next.UserID)
	}
}

func TestSchedulerAcquireCancellationDoesNotLeakLease(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	_, release, err := scheduler.Acquire(context.Background(), nil)
	if err != nil {
		t.Fatalf("Acquire(first): %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)

	go func() {
		_, nextRelease, err := scheduler.Acquire(ctx, nil)
		if err == nil {
			nextRelease()
		}
		result <- err
	}()

	cancel()

	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Acquire(cancelled) = %v, want context.Canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled Acquire did not return")
	}

	release()

	nextCtx, nextCancel := context.WithTimeout(context.Background(), time.Second)
	defer nextCancel()

	bot, nextRelease, err := scheduler.Acquire(nextCtx, nil)
	if err != nil {
		t.Fatalf("Acquire(after cancellation): %v", err)
	}
	defer nextRelease()

	if bot.UserID != "1" {
		t.Fatalf("bot = %s, want 1", bot.UserID)
	}
}

func TestSchedulerAcquireDoesNotWaitForCooldown(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})
	scheduler.Cooldown("1", 250*time.Millisecond)

	start := time.Now()
	_, _, err := scheduler.Acquire(context.Background(), nil)
	elapsed := time.Since(start)

	if !errors.Is(err, blobstore.ErrNoUsableBot) {
		t.Fatalf("Acquire() error = %v, want ErrNoUsableBot", err)
	}
	if elapsed >= 100*time.Millisecond {
		t.Fatalf("Acquire() waited %s for cooldown", elapsed)
	}
}
