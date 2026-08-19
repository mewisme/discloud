package discordstore

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

func TestSchedulerRoundRobin(t *testing.T) {
	scheduler := NewScheduler([]Bot{
		{UserID: "1"},
		{UserID: "2"},
		{UserID: "3"},
	})

	want := []string{"1", "2", "3", "1", "2", "3"}

	for i, expected := range want {
		bot, err := scheduler.Next(nil)
		if err != nil {
			t.Fatalf("Next(%d): %v", i, err)
		}
		if bot.UserID != expected {
			t.Fatalf("Next(%d) = %s, want %s", i, bot.UserID, expected)
		}
	}
}

func TestSchedulerExclusion(t *testing.T) {
	scheduler := NewScheduler([]Bot{
		{UserID: "1"},
		{UserID: "2"},
		{UserID: "3"},
	})

	bot, err := scheduler.Next([]string{"1", "2"})
	if err != nil {
		t.Fatalf("Next(): %v", err)
	}
	if bot.UserID != "3" {
		t.Fatalf("bot = %s, want 3", bot.UserID)
	}

	_, err = scheduler.Next([]string{"1", "2", "3"})
	if !errors.Is(err, blobstore.ErrNoUsableBot) {
		t.Fatalf("Next(all excluded) = %v", err)
	}
}

func TestSchedulerCooldown(t *testing.T) {
	now := time.Unix(1000, 0)
	scheduler := newSchedulerWithClock(
		[]Bot{
			{UserID: "1"},
			{UserID: "2"},
		},
		func() time.Time { return now },
	)

	scheduler.Cooldown("1", time.Minute)

	bot, err := scheduler.Next(nil)
	if err != nil {
		t.Fatalf("Next(): %v", err)
	}
	if bot.UserID != "2" {
		t.Fatalf("bot = %s, want 2", bot.UserID)
	}

	now = now.Add(time.Minute)

	bot, err = scheduler.Next(nil)
	if err != nil {
		t.Fatalf("Next() after cooldown: %v", err)
	}
	if bot.UserID != "1" {
		t.Fatalf("bot = %s, want 1", bot.UserID)
	}
}

func TestSchedulerConcurrent(t *testing.T) {
	scheduler := NewScheduler([]Bot{
		{UserID: "1"},
		{UserID: "2"},
		{UserID: "3"},
		{UserID: "4"},
	})

	const calls = 400

	counts := make(map[string]int)
	var countsMu sync.Mutex
	var wg sync.WaitGroup

	for range calls {
		wg.Add(1)

		go func() {
			defer wg.Done()

			bot, err := scheduler.Next(nil)
			if err != nil {
				t.Errorf("Next(): %v", err)
				return
			}

			countsMu.Lock()
			counts[bot.UserID]++
			countsMu.Unlock()
		}()
	}

	wg.Wait()

	for _, userID := range []string{"1", "2", "3", "4"} {
		if counts[userID] != calls/4 {
			t.Fatalf("bot %s count = %d, want %d", userID, counts[userID], calls/4)
		}
	}
}
