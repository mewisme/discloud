package discordstore

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestDegradedStartupKeepsResolvedBots(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("Authorization") {
		case "Bot token-a":
			writeBotUserJSON(t, w, User{ID: "111", Username: "storage-a", GlobalName: "Storage A", Avatar: "avatar-a", Bot: true})
		case "Bot token-b":
			writeDiscordErrorJSON(w, http.StatusUnauthorized, "invalid token token-b")
		case "Bot token-c":
			writeBotUserJSON(t, w, User{ID: "333", Username: "storage-c", GlobalName: "Storage C", Bot: true})
		default:
			http.Error(w, "unexpected token", http.StatusUnauthorized)
		}
	}))
	defer server.Close()

	store, err := NewWithClient(
		context.Background(),
		"channel",
		[]string{"token-a", "token-b", "token-c"},
		NewClientWithBaseURL(server.Client(), server.URL),
	)
	if err != nil {
		t.Fatalf("NewWithClient(): %v", err)
	}

	if got := store.BotCount(); got != 2 {
		t.Fatalf("BotCount() = %d, want 2", got)
	}
	if got := store.EffectiveCapacity(); got != 2 {
		t.Fatalf("EffectiveCapacity() = %d, want 2", got)
	}

	snapshot := store.RuntimeSnapshot()
	if snapshot.Capacity.Configured != 3 || snapshot.Resolved != 2 || snapshot.Unresolved != 1 {
		t.Fatalf("snapshot counts = configured %d resolved %d unresolved %d", snapshot.Capacity.Configured, snapshot.Resolved, snapshot.Unresolved)
	}
	if len(snapshot.Bots) != 3 {
		t.Fatalf("bots = %d, want 3", len(snapshot.Bots))
	}

	resolved := runtimeBotEntryByConfigIndex(t, snapshot, 0)
	if !resolved.Resolved || resolved.UserID != "111" {
		t.Fatalf("resolved entry = %+v", resolved)
	}

	unresolved := runtimeBotEntryByConfigIndex(t, snapshot, 1)
	if unresolved.Resolved || unresolved.UserID != "" || unresolved.State != BotRuntimeUnhealthy {
		t.Fatalf("unresolved entry = %+v", unresolved)
	}
	if unresolved.ResolveErrorClass != "auth" || unresolved.ResolveErrorMessage != "Discord authentication failed" {
		t.Fatalf("unresolved diagnostics = %q %q", unresolved.ResolveErrorClass, unresolved.ResolveErrorMessage)
	}

	data, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	for _, secret := range []string{"token-a", "token-b", "token-c"} {
		if strings.Contains(string(data), secret) {
			t.Fatalf("runtime snapshot leaked configured token %q", secret)
		}
	}
}

func TestDegradedStartupAllowsAllBotsUnresolved(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeDiscordErrorJSON(w, http.StatusUnauthorized, "invalid credentials")
	}))
	defer server.Close()

	store, err := NewWithClient(
		context.Background(),
		"channel",
		[]string{"token-a", "token-b"},
		NewClientWithBaseURL(server.Client(), server.URL),
	)
	if err != nil {
		t.Fatalf("NewWithClient(): %v", err)
	}

	if got := store.BotCount(); got != 0 {
		t.Fatalf("BotCount() = %d, want 0", got)
	}
	if got := store.EffectiveCapacity(); got != 0 {
		t.Fatalf("EffectiveCapacity() = %d, want 0", got)
	}

	snapshot := store.RuntimeSnapshot()
	if snapshot.Capacity.Configured != 2 || snapshot.Resolved != 0 || snapshot.Unresolved != 2 {
		t.Fatalf("snapshot counts = configured %d resolved %d unresolved %d", snapshot.Capacity.Configured, snapshot.Resolved, snapshot.Unresolved)
	}
}

func TestDegradedStartupKeepsDuplicateConfiguredIdentityUnresolved(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeBotUserJSON(t, w, User{ID: "111", Username: "same-bot", Bot: true})
	}))
	defer server.Close()

	store, err := NewWithClient(
		context.Background(),
		"channel",
		[]string{"token-a", "token-b"},
		NewClientWithBaseURL(server.Client(), server.URL),
	)
	if err != nil {
		t.Fatalf("NewWithClient(): %v", err)
	}

	snapshot := store.RuntimeSnapshot()
	if snapshot.Resolved != 1 || snapshot.Unresolved != 1 {
		t.Fatalf("resolved = %d unresolved = %d", snapshot.Resolved, snapshot.Unresolved)
	}

	duplicate := runtimeBotEntryByConfigIndex(t, snapshot, 1)
	if duplicate.ResolveErrorClass != "duplicate" {
		t.Fatalf("duplicate error class = %q", duplicate.ResolveErrorClass)
	}
}

func TestConfiguredBotProbeRecoversUnresolvedBot(t *testing.T) {
	var recoverSecond atomic.Bool

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("Authorization") {
		case "Bot token-a":
			writeBotUserJSON(t, w, User{ID: "111", Username: "storage-a", GlobalName: "Storage A", Bot: true})
		case "Bot token-b":
			if !recoverSecond.Load() {
				writeDiscordErrorJSON(w, http.StatusServiceUnavailable, "temporary upstream failure")
				return
			}
			writeBotUserJSON(t, w, User{ID: "222", Username: "storage-b", GlobalName: "Storage B", Avatar: "avatar-b", Bot: true})
		default:
			http.Error(w, "unexpected token", http.StatusUnauthorized)
		}
	}))
	defer server.Close()

	store, err := NewWithClient(
		context.Background(),
		"channel",
		[]string{"token-a", "token-b"},
		NewClientWithBaseURL(server.Client(), server.URL),
	)
	if err != nil {
		t.Fatalf("NewWithClient(): %v", err)
	}
	if got := store.EffectiveCapacity(); got != 1 {
		t.Fatalf("initial EffectiveCapacity() = %d, want 1", got)
	}

	recoverSecond.Store(true)
	if err := store.ProbeConfiguredBot(context.Background(), 1); err != nil {
		t.Fatalf("ProbeConfiguredBot(): %v", err)
	}

	if got := store.EffectiveCapacity(); got != 2 {
		t.Fatalf("EffectiveCapacity() after recovery = %d, want 2", got)
	}

	entry := runtimeBotEntryByConfigIndex(t, store.RuntimeSnapshot(), 1)
	if !entry.Resolved || entry.UserID != "222" || entry.Username != "storage-b" || entry.DisplayName != "Storage B" {
		t.Fatalf("recovered entry = %+v", entry)
	}
	if entry.ResolveErrorClass != "" || entry.ResolveErrorMessage != "" {
		t.Fatalf("recovery left diagnostics: %q %q", entry.ResolveErrorClass, entry.ResolveErrorMessage)
	}

	selected, err := store.SelectUploadBot([]string{"111"})
	if err != nil {
		t.Fatalf("SelectUploadBot(): %v", err)
	}
	if selected != "222" {
		t.Fatalf("selected = %q, want 222", selected)
	}
}

func TestConfiguredBotProbeRejectsDuplicateRecoveredIdentity(t *testing.T) {
	var recoverSecond atomic.Bool

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("Authorization") {
		case "Bot token-a":
			writeBotUserJSON(t, w, User{ID: "111", Username: "storage-a", Bot: true})
		case "Bot token-b":
			if !recoverSecond.Load() {
				writeDiscordErrorJSON(w, http.StatusServiceUnavailable, "temporary failure")
				return
			}
			writeBotUserJSON(t, w, User{ID: "111", Username: "same-storage-bot", Bot: true})
		}
	}))
	defer server.Close()

	store, err := NewWithClient(
		context.Background(),
		"channel",
		[]string{"token-a", "token-b"},
		NewClientWithBaseURL(server.Client(), server.URL),
	)
	if err != nil {
		t.Fatalf("NewWithClient(): %v", err)
	}

	recoverSecond.Store(true)
	err = store.ProbeConfiguredBot(context.Background(), 1)
	if !errors.Is(err, ErrDuplicateBotUser) {
		t.Fatalf("ProbeConfiguredBot() = %v, want ErrDuplicateBotUser", err)
	}
	if got := store.BotCount(); got != 1 {
		t.Fatalf("BotCount() = %d, want 1", got)
	}

	entry := runtimeBotEntryByConfigIndex(t, store.RuntimeSnapshot(), 1)
	if entry.Resolved || entry.ResolveErrorClass != "duplicate" {
		t.Fatalf("duplicate entry = %+v", entry)
	}
}

func TestConfiguredBotProbeRejectsMissingConfigIndex(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeBotUserJSON(t, w, User{ID: "111", Username: "storage", Bot: true})
	}))
	defer server.Close()

	store, err := NewWithClient(
		context.Background(),
		"channel",
		[]string{"token"},
		NewClientWithBaseURL(server.Client(), server.URL),
	)
	if err != nil {
		t.Fatalf("NewWithClient(): %v", err)
	}

	if err := store.ProbeConfiguredBot(context.Background(), 99); !errors.Is(err, ErrConfiguredBotNotFound) {
		t.Fatalf("ProbeConfiguredBot() = %v, want ErrConfiguredBotNotFound", err)
	}
}

func TestDegradedStartupRejectsNoConfiguredTokens(t *testing.T) {
	_, err := NewWithClient(context.Background(), "channel", nil, NewClient(nil))
	if !errors.Is(err, ErrNoBotTokens) {
		t.Fatalf("NewWithClient() = %v, want ErrNoBotTokens", err)
	}
}

func TestDegradedStartupStillHonorsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("Discord request should not complete after canceled startup context")
	}))
	defer server.Close()

	_, err := NewWithClient(ctx, "channel", []string{"token"}, NewClientWithBaseURL(server.Client(), server.URL))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("NewWithClient() = %v, want context.Canceled", err)
	}
}

func runtimeBotEntryByConfigIndex(t *testing.T, snapshot BotRuntimeSnapshot, configIndex int) BotRuntimeEntry {
	t.Helper()
	for _, bot := range snapshot.Bots {
		if bot.ConfigIndex == configIndex {
			return bot
		}
	}
	t.Fatalf("runtime bot with config index %d not found", configIndex)
	return BotRuntimeEntry{}
}

func writeDiscordErrorJSON(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"message": message})
}
