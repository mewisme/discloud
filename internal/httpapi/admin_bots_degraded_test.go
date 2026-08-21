package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/discordstore"
)

func TestBotRuntimeSnapshotProjectsUnresolvedConfiguredBot(t *testing.T) {
	now := time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC)
	provider := &fakeBotRuntimeProvider{
		snapshot: discordstore.BotRuntimeSnapshot{
			SchedulerRuntimeSnapshot: discordstore.SchedulerRuntimeSnapshot{
				GeneratedAt: now,
				Capacity:    discordstore.SchedulerCapacity{Configured: 2, Effective: 1, Available: 1},
				Idle:        1,
			},
			Resolved:   1,
			Unresolved: 1,
			Bots: []discordstore.BotRuntimeEntry{
				{
					ConfigIndex: 0,
					Resolved:    true,
					RuntimeBot: discordstore.RuntimeBot{
						UserID:      "111",
						Username:    "storage-a",
						DisplayName: "Storage A",
						State:       discordstore.BotRuntimeIdle,
					},
				},
				{
					ConfigIndex:         1,
					Resolved:            false,
					RuntimeBot:          discordstore.RuntimeBot{State: discordstore.BotRuntimeUnhealthy},
					ResolveErrorClass:   "auth",
					ResolveErrorMessage: "Discord authentication failed",
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

	if response.Summary.Configured != 2 || response.Summary.Resolved != 1 || response.Summary.Unresolved != 1 {
		t.Fatalf("summary = %+v", response.Summary)
	}
	if len(response.Bots) != 2 {
		t.Fatalf("bots = %d, want 2", len(response.Bots))
	}

	unresolved := response.Bots[1]
	if unresolved.ConfigIndex != 1 || unresolved.Resolved || unresolved.ID != nil || unresolved.State != "unhealthy" {
		t.Fatalf("unresolved = %+v", unresolved)
	}
	if unresolved.ResolveErrorClass != "auth" || unresolved.ResolveErrorMessage == "" {
		t.Fatalf("unresolved diagnostics = %+v", unresolved)
	}
	if strings.Contains(strings.ToLower(unresolved.ResolveErrorMessage), "token") {
		t.Fatalf("unsafe resolution message = %q", unresolved.ResolveErrorMessage)
	}
}
