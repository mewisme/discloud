package discordstore

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

func TestSchedulerRuntimeTracksLeaseMetadata(t *testing.T) {
	scheduler := NewScheduler([]Bot{
		{
			UserID:      "1",
			Username:    "storage",
			DisplayName: "Storage Bot",
			Avatar:      "avatar",
			Token:       "secret-token",
		},
	})

	partIndex := 7
	bot, release, err := scheduler.Acquire(
		context.Background(),
		nil,
		blobstore.LeaseMetadata{
			Operation: blobstore.LeaseOperationUpload,
			UploadID:  "upload-1",
			FileName:  "movie.mkv",
			PartIndex: &partIndex,
			SizeBytes: 10 * 1024 * 1024,
		},
	)
	if err != nil {
		t.Fatalf("Acquire(): %v", err)
	}

	snapshot := scheduler.Snapshot()

	if snapshot.Working != 1 ||
		snapshot.ActiveLeases != 1 ||
		len(snapshot.Bots) != 1 {
		t.Fatalf("snapshot = %+v", snapshot)
	}

	runtimeBot := snapshot.Bots[0]
	if runtimeBot.UserID != bot.UserID {
		t.Fatalf(
			"UserID = %q, want %q",
			runtimeBot.UserID,
			bot.UserID,
		)
	}

	if runtimeBot.State != BotRuntimeWorking {
		t.Fatalf(
			"State = %q, want %q",
			runtimeBot.State,
			BotRuntimeWorking,
		)
	}

	if runtimeBot.Lease == nil {
		t.Fatal("Lease is nil")
	}

	lease := runtimeBot.Lease
	if lease.Operation != blobstore.LeaseOperationUpload ||
		lease.UploadID != "upload-1" ||
		lease.FileName != "movie.mkv" ||
		lease.PartIndex == nil ||
		*lease.PartIndex != 7 ||
		lease.SizeBytes != 10*1024*1024 {
		t.Fatalf("Lease = %+v", lease)
	}

	scheduler.RecordSuccess(bot.UserID, lease.SizeBytes)
	release()

	snapshot = scheduler.Snapshot()
	if snapshot.Working != 0 ||
		snapshot.ActiveLeases != 0 ||
		snapshot.Idle != 1 {
		t.Fatalf("snapshot after release = %+v", snapshot)
	}

	metrics := snapshot.Bots[0].Metrics
	if metrics.OperationsSucceeded != 1 {
		t.Fatalf(
			"OperationsSucceeded = %d, want 1",
			metrics.OperationsSucceeded,
		)
	}

	if metrics.BytesTransferred != 10*1024*1024 {
		t.Fatalf(
			"BytesTransferred = %d",
			metrics.BytesTransferred,
		)
	}
}

func TestSchedulerRuntimeNeverExposesToken(t *testing.T) {
	scheduler := NewScheduler([]Bot{
		{
			UserID:      "1",
			Username:    "storage",
			DisplayName: "Storage",
			Token:       "super-secret-token",
		},
	})

	data, err := json.Marshal(scheduler.Snapshot())
	if err != nil {
		t.Fatalf("Marshal(): %v", err)
	}

	if strings.Contains(
		string(data),
		"super-secret-token",
	) {
		t.Fatal("runtime snapshot exposed bot token")
	}
}

func TestSchedulerRuntimeTracksWaitingQueue(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	_, releaseFirst, err := scheduler.Acquire(
		context.Background(),
		nil,
		blobstore.LeaseMetadata{
			Operation: blobstore.LeaseOperationUpload,
		},
	)
	if err != nil {
		t.Fatalf("Acquire(first): %v", err)
	}

	ctx, cancel := context.WithTimeout(
		context.Background(),
		time.Second,
	)
	defer cancel()

	acquired := make(chan struct{})
	go func() {
		_, release, err := scheduler.Acquire(
			ctx,
			nil,
			blobstore.LeaseMetadata{
				Operation: blobstore.LeaseOperationResolve,
			},
		)
		if err == nil {
			release()
		}
		close(acquired)
	}()

	deadline := time.Now().Add(time.Second)

	for {
		snapshot := scheduler.Snapshot()
		queue := snapshot.Queues[blobstore.LeaseOperationResolve]

		if queue.Depth == 1 {
			if snapshot.TotalWaiting != 1 {
				t.Fatalf(
					"TotalWaiting = %d, want 1",
					snapshot.TotalWaiting,
				)
			}
			break
		}

		if time.Now().After(deadline) {
			t.Fatal("resolve waiter did not enter queue")
		}

		time.Sleep(time.Millisecond)
	}

	releaseFirst()

	select {
	case <-acquired:
	case <-ctx.Done():
		t.Fatal("queued acquire did not resume")
	}

	snapshot := scheduler.Snapshot()
	if snapshot.TotalWaiting != 0 {
		t.Fatalf(
			"TotalWaiting = %d, want 0",
			snapshot.TotalWaiting,
		)
	}
}

func TestSchedulerRuntimeTracksCooldown(t *testing.T) {
	now := time.Unix(1000, 0)

	scheduler := newSchedulerWithClock(
		[]Bot{{UserID: "1"}, {UserID: "2"}},
		func() time.Time { return now },
	)

	scheduler.Cooldown("1", time.Minute)

	snapshot := scheduler.Snapshot()
	if snapshot.Cooldown != 1 {
		t.Fatalf(
			"Cooldown = %d, want 1",
			snapshot.Cooldown,
		)
	}

	if snapshot.Capacity.Effective != 1 {
		t.Fatalf(
			"Effective = %d, want 1",
			snapshot.Capacity.Effective,
		)
	}

	now = now.Add(time.Minute)

	snapshot = scheduler.Snapshot()
	if snapshot.Cooldown != 0 {
		t.Fatalf(
			"Cooldown after expiry = %d, want 0",
			snapshot.Cooldown,
		)
	}

	if snapshot.Capacity.Effective != 2 {
		t.Fatalf(
			"Effective after expiry = %d, want 2",
			snapshot.Capacity.Effective,
		)
	}
}

func TestSchedulerRuntimeTracksFailures(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	bot, release, err := scheduler.Acquire(
		context.Background(),
		nil,
		blobstore.LeaseMetadata{
			Operation: blobstore.LeaseOperationUpload,
		},
	)
	if err != nil {
		t.Fatalf("Acquire(): %v", err)
	}
	defer release()

	upstream := &UpstreamError{
		Class:      ErrorRateLimited,
		BotUserID:  bot.UserID,
		Retryable:  true,
		RetryAfter: time.Second,
		Cause:      errors.New("rate limited"),
	}

	scheduler.RecordFailure(bot.UserID, upstream)

	metrics := scheduler.Snapshot().Bots[0].Metrics

	if metrics.OperationsFailed != 1 {
		t.Fatalf(
			"OperationsFailed = %d, want 1",
			metrics.OperationsFailed,
		)
	}

	if metrics.RateLimitedCount != 1 {
		t.Fatalf(
			"RateLimitedCount = %d, want 1",
			metrics.RateLimitedCount,
		)
	}

	if metrics.LastErrorClass != ErrorRateLimited {
		t.Fatalf(
			"LastErrorClass = %q",
			metrics.LastErrorClass,
		)
	}
}

func TestSchedulerRuntimeEventWindowAndSubscription(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	events, unsubscribe := scheduler.Subscribe(8)
	defer unsubscribe()

	_, release, err := scheduler.Acquire(
		context.Background(),
		nil,
		blobstore.LeaseMetadata{
			Operation: blobstore.LeaseOperationUpload,
		},
	)
	if err != nil {
		t.Fatalf("Acquire(): %v", err)
	}

	select {
	case event := <-events:
		if event.Type != RuntimeEventLeaseStarted {
			t.Fatalf(
				"event = %q, want %q",
				event.Type,
				RuntimeEventLeaseStarted,
			)
		}
	case <-time.After(time.Second):
		t.Fatal("did not receive runtime event")
	}

	release()

	window := scheduler.EventsSince(0)
	if len(window.Events) < 2 {
		t.Fatalf(
			"events = %d, want at least 2",
			len(window.Events),
		)
	}

	if window.OldestID == 0 ||
		window.LatestID < window.OldestID {
		t.Fatalf("window = %+v", window)
	}
}
