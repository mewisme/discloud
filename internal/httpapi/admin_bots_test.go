package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/discordstore"
)

type fakeBotRuntimeProvider struct {
	snapshot discordstore.SchedulerRuntimeSnapshot
	window   discordstore.RuntimeEventWindow
	events   chan discordstore.RuntimeEvent
}

func (p *fakeBotRuntimeProvider) RuntimeSnapshot() discordstore.SchedulerRuntimeSnapshot {
	return p.snapshot
}

func (p *fakeBotRuntimeProvider) RuntimeEventsSince(uint64) discordstore.RuntimeEventWindow {
	return p.window
}

func (p *fakeBotRuntimeProvider) SubscribeRuntime(int) (<-chan discordstore.RuntimeEvent, func()) {
	if p.events == nil {
		p.events = make(chan discordstore.RuntimeEvent)
	}
	return p.events, func() {}
}

func TestBotRuntimeSnapshotHandler(t *testing.T) {
	now := time.Date(2026, 8, 21, 1, 0, 0, 0, time.UTC)
	partIndex := 7

	provider := &fakeBotRuntimeProvider{
		snapshot: discordstore.SchedulerRuntimeSnapshot{
			GeneratedAt: now,
			Capacity: discordstore.SchedulerCapacity{
				Configured: 2,
				Effective:  2,
				Available:  1,
			},
			Working:       1,
			Idle:          1,
			ActiveLeases:  1,
			TotalWaiting:  2,
			LatestEventID: 14,
			Queues: map[blobstore.LeaseOperation]discordstore.RuntimeQueue{
				blobstore.LeaseOperationUpload: {
					Depth:      2,
					OldestWait: 1500 * time.Millisecond,
				},
			},
			Bots: []discordstore.RuntimeBot{
				{
					UserID:      "123",
					Username:    "storage-bot",
					DisplayName: "Storage Bot",
					Avatar:      "avatar-hash",
					State:       discordstore.BotRuntimeWorking,
					Working:     true,
					Lease: &discordstore.RuntimeLease{
						Operation: blobstore.LeaseOperationUpload,
						StartedAt: now.Add(-2 * time.Second),
						Duration:  2 * time.Second,
						UploadID:  "upload-1",
						FileName:  "movie.mkv",
						PartIndex: &partIndex,
						SizeBytes: 10 * 1024 * 1024,
					},
					Metrics: discordstore.RuntimeBotMetrics{
						OperationsSucceeded:          5,
						BytesTransferred:             50 * 1024 * 1024,
						LastOperationDuration:        2 * time.Second,
						LastThroughputBytesPerSecond: 5 * 1024 * 1024,
					},
				},
			},
		},
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/bots", nil)

	botRuntimeSnapshotHandler(provider).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}

	var response adminBotRuntimeResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if response.Summary.Configured != 2 ||
		response.Summary.EffectiveCapacity != 2 ||
		response.Summary.AvailableNow != 1 ||
		response.Summary.Working != 1 ||
		response.Summary.TotalWaiting != 2 {
		t.Fatalf("summary = %+v", response.Summary)
	}

	queue := response.Queues["upload"]
	if queue.Depth != 2 || queue.OldestWaitMS != 1500 {
		t.Fatalf("upload queue = %+v", queue)
	}

	if len(response.Bots) != 1 {
		t.Fatalf("bots = %d, want 1", len(response.Bots))
	}

	bot := response.Bots[0]
	if bot.ID != "123" ||
		bot.Username != "storage-bot" ||
		bot.DisplayName != "Storage Bot" {
		t.Fatalf("bot identity = %+v", bot)
	}

	if bot.AvatarURL != "https://cdn.discordapp.com/avatars/123/avatar-hash.png?size=128" {
		t.Fatalf("avatarUrl = %q", bot.AvatarURL)
	}

	if bot.Lease == nil ||
		bot.Lease.Operation != "upload" ||
		bot.Lease.PartIndex == nil ||
		*bot.Lease.PartIndex != 7 {
		t.Fatalf("lease = %+v", bot.Lease)
	}
}

func TestBotRuntimeEventsHandlerReplaysEvents(t *testing.T) {
	now := time.Now().UTC()

	provider := &fakeBotRuntimeProvider{
		window: discordstore.RuntimeEventWindow{
			OldestID: 1,
			LatestID: 2,
			Events: []discordstore.RuntimeEvent{
				{
					ID:        2,
					Type:      discordstore.RuntimeEventLeaseFinished,
					At:        now,
					BotUserID: "123",
					Operation: blobstore.LeaseOperationUpload,
					Duration:  time.Second,
				},
			},
		},
		events: make(chan discordstore.RuntimeEvent),
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	request := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/admin/bots/events",
		nil,
	).WithContext(ctx)
	request.Header.Set("Last-Event-ID", "1")

	recorder := httptest.NewRecorder()
	botRuntimeEventsHandler(provider).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}

	if got := recorder.Header().Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("Content-Type = %q", got)
	}

	body := recorder.Body.String()
	for _, want := range []string{
		"event: ready",
		"id: 2",
		"event: bot.lease.finished",
		`"botId":"123"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("response missing %q:\n%s", want, body)
		}
	}
}

func TestBotRuntimeEventsHandlerRequestsResetOnReplayGap(t *testing.T) {
	provider := &fakeBotRuntimeProvider{
		window: discordstore.RuntimeEventWindow{
			OldestID: 5,
			LatestID: 8,
			Events: []discordstore.RuntimeEvent{
				{
					ID:   5,
					Type: discordstore.RuntimeEventQueueChanged,
				},
			},
		},
		events: make(chan discordstore.RuntimeEvent),
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	request := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/admin/bots/events",
		nil,
	).WithContext(ctx)
	request.Header.Set("Last-Event-ID", "1")

	recorder := httptest.NewRecorder()
	botRuntimeEventsHandler(provider).ServeHTTP(recorder, request)

	body := recorder.Body.String()
	if !strings.Contains(body, "event: reset") {
		t.Fatalf("response missing reset event:\n%s", body)
	}
	if !strings.Contains(body, `"latestEventId":8`) {
		t.Fatalf("response missing latest event ID:\n%s", body)
	}
	if strings.Contains(body, "id: 5") {
		t.Fatalf("stale replay event was emitted after reset:\n%s", body)
	}
}

func TestBotRuntimeEventsHandlerRejectsInvalidLastEventID(t *testing.T) {
	provider := &fakeBotRuntimeProvider{}

	request := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/admin/bots/events",
		nil,
	)
	request.Header.Set("Last-Event-ID", "not-a-number")

	recorder := httptest.NewRecorder()
	botRuntimeEventsHandler(provider).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf(
			"status = %d, want %d",
			recorder.Code,
			http.StatusBadRequest,
		)
	}
}

func TestRuntimeReplayGap(t *testing.T) {
	tests := []struct {
		name   string
		after  uint64
		window discordstore.RuntimeEventWindow
		want   bool
	}{
		{
			name:  "new client",
			after: 0,
			window: discordstore.RuntimeEventWindow{
				OldestID: 5,
				LatestID: 10,
			},
		},
		{
			name:  "replay available",
			after: 4,
			window: discordstore.RuntimeEventWindow{
				OldestID: 5,
				LatestID: 10,
			},
		},
		{
			name:  "ring buffer gap",
			after: 2,
			window: discordstore.RuntimeEventWindow{
				OldestID: 5,
				LatestID: 10,
			},
			want: true,
		},
		{
			name:  "server restarted",
			after: 100,
			window: discordstore.RuntimeEventWindow{
				LatestID: 3,
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := runtimeReplayGap(tt.after, tt.window); got != tt.want {
				t.Fatalf("runtimeReplayGap() = %v, want %v", got, tt.want)
			}
		})
	}
}
