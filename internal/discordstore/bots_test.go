package discordstore

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveBotsRetainsDiscordIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/users/@me" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bot token-a" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		writeBotUserJSON(t, w, User{
			ID:         "123456789012345678",
			Username:   "discloud-storage",
			GlobalName: "DisCloud Storage",
			Avatar:     "avatar-hash",
			Bot:        true,
		})
	}))
	defer server.Close()

	client := NewClientWithBaseURL(server.Client(), server.URL)
	bots, err := ResolveBots(context.Background(), client, []string{"token-a"})
	if err != nil {
		t.Fatalf("ResolveBots(): %v", err)
	}
	if len(bots) != 1 {
		t.Fatalf("bots = %d, want 1", len(bots))
	}

	bot := bots[0]
	if bot.UserID != "123456789012345678" {
		t.Fatalf("UserID = %q", bot.UserID)
	}
	if bot.Username != "discloud-storage" {
		t.Fatalf("Username = %q", bot.Username)
	}
	if bot.DisplayName != "DisCloud Storage" {
		t.Fatalf("DisplayName = %q", bot.DisplayName)
	}
	if bot.Avatar != "avatar-hash" {
		t.Fatalf("Avatar = %q", bot.Avatar)
	}
	if bot.Token != "token-a" {
		t.Fatalf("Token was not retained internally")
	}
}

func TestResolveBotsFallsBackDisplayNameToUsername(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeBotUserJSON(t, w, User{
			ID:       "123",
			Username: "storage-bot",
			Bot:      true,
		})
	}))
	defer server.Close()

	client := NewClientWithBaseURL(server.Client(), server.URL)
	bots, err := ResolveBots(context.Background(), client, []string{"token"})
	if err != nil {
		t.Fatalf("ResolveBots(): %v", err)
	}

	if got := bots[0].DisplayName; got != "storage-bot" {
		t.Fatalf("DisplayName = %q, want storage-bot", got)
	}
}

func TestResolveBotsRejectsNonBotUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeBotUserJSON(t, w, User{
			ID:       "123",
			Username: "regular-user",
			Bot:      false,
		})
	}))
	defer server.Close()

	client := NewClientWithBaseURL(server.Client(), server.URL)
	_, err := ResolveBots(context.Background(), client, []string{"token"})

	if !errors.Is(err, ErrInvalidBotToken) {
		t.Fatalf("ResolveBots() = %v, want ErrInvalidBotToken", err)
	}
}

func TestResolveBotsRejectsDuplicateDiscordUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeBotUserJSON(t, w, User{
			ID:       "123",
			Username: "same-bot",
			Bot:      true,
		})
	}))
	defer server.Close()

	client := NewClientWithBaseURL(server.Client(), server.URL)
	_, err := ResolveBots(context.Background(), client, []string{"token-a", "token-b"})

	if !errors.Is(err, ErrDuplicateBotUser) {
		t.Fatalf("ResolveBots() = %v, want ErrDuplicateBotUser", err)
	}
}

func writeBotUserJSON(t *testing.T, w http.ResponseWriter, user User) {
	t.Helper()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(user); err != nil {
		t.Fatalf("encode Discord user: %v", err)
	}
}
