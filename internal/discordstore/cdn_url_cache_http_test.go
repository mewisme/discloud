package discordstore

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

func TestStoreCachesResolvedAttachmentURL(t *testing.T) {
	data := []byte("hello")
	expiry := strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 16)

	var (
		server          *httptest.Server
		messageRequests atomic.Int32
	)

	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/users/@me":
			writeJSON(t, w, User{ID: "bot-a", Bot: true})

		case r.Method == http.MethodGet &&
			r.URL.Path == "/channels/channel-1/messages/message-1":
			messageRequests.Add(1)
			writeJSON(t, w, Message{
				ID:        "message-1",
				ChannelID: "channel-1",
				Attachments: []Attachment{
					{
						ID:   "attachment-1",
						Size: int64(len(data)),
						URL:  server.URL + "/cdn/attachment-1?ex=" + expiry,
					},
				},
			})

		case r.Method == http.MethodGet &&
			r.URL.Path == "/cdn/attachment-1":
			_, _ = w.Write(data)

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	store, err := NewWithClient(
		context.Background(),
		"channel-1",
		[]string{"token-a"},
		NewClientWithBaseURL(server.Client(), server.URL),
	)
	if err != nil {
		t.Fatalf("NewWithClient(): %v", err)
	}

	location := blobstore.Location{
		DiscordChannelID:    "channel-1",
		DiscordMessageID:    "message-1",
		DiscordAttachmentID: "attachment-1",
	}

	for attempt := 0; attempt < 2; attempt++ {
		reader, err := store.OpenChunk(context.Background(), location, 0, 0)
		if err != nil {
			t.Fatalf("OpenChunk() attempt %d: %v", attempt+1, err)
		}

		got, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatalf("read chunk attempt %d: %v", attempt+1, err)
		}
		if string(got) != string(data) {
			t.Fatalf("chunk attempt %d = %q, want %q", attempt+1, got, data)
		}
	}

	if got := messageRequests.Load(); got != 1 {
		t.Fatalf("Discord message requests = %d, want 1", got)
	}
}

func TestStoreRefreshesRejectedCachedAttachmentURL(t *testing.T) {
	data := []byte("hello")
	expiry := strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 16)

	var (
		server          *httptest.Server
		messageRequests atomic.Int32
		staleRequests   atomic.Int32
		freshRequests   atomic.Int32
	)

	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/users/@me":
			writeJSON(t, w, User{ID: "bot-a", Bot: true})

		case r.Method == http.MethodGet &&
			r.URL.Path == "/channels/channel-1/messages/message-1":
			request := messageRequests.Add(1)
			path := "/cdn/stale"
			if request > 1 {
				path = "/cdn/fresh"
			}

			writeJSON(t, w, Message{
				ID:        "message-1",
				ChannelID: "channel-1",
				Attachments: []Attachment{
					{
						ID:   "attachment-1",
						Size: int64(len(data)),
						URL:  server.URL + path + "?ex=" + expiry,
					},
				},
			})

		case r.Method == http.MethodGet && r.URL.Path == "/cdn/stale":
			staleRequests.Add(1)
			http.Error(w, "expired signed URL", http.StatusForbidden)

		case r.Method == http.MethodGet && r.URL.Path == "/cdn/fresh":
			freshRequests.Add(1)
			_, _ = w.Write(data)

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	store, err := NewWithClient(
		context.Background(),
		"channel-1",
		[]string{"token-a"},
		NewClientWithBaseURL(server.Client(), server.URL),
	)
	if err != nil {
		t.Fatalf("NewWithClient(): %v", err)
	}

	location := blobstore.Location{
		DiscordChannelID:    "channel-1",
		DiscordMessageID:    "message-1",
		DiscordAttachmentID: "attachment-1",
	}

	rawURL, _, err := store.ResolveAttachmentURL(context.Background(), location)
	if err != nil {
		t.Fatalf("initial ResolveAttachmentURL(): %v", err)
	}
	if !strings.Contains(rawURL, "/cdn/stale") {
		t.Fatalf("initial URL = %q, want stale URL", rawURL)
	}

	reader, err := store.OpenChunk(context.Background(), location, 0, 0)
	if err != nil {
		t.Fatalf("OpenChunk(): %v", err)
	}

	got, err := io.ReadAll(reader)
	reader.Close()
	if err != nil {
		t.Fatalf("read refreshed chunk: %v", err)
	}
	if string(got) != string(data) {
		t.Fatalf("refreshed chunk = %q, want %q", got, data)
	}

	if got := messageRequests.Load(); got != 2 {
		t.Fatalf("Discord message requests = %d, want 2", got)
	}
	if got := staleRequests.Load(); got != 1 {
		t.Fatalf("stale CDN requests = %d, want 1", got)
	}
	if got := freshRequests.Load(); got != 1 {
		t.Fatalf("fresh CDN requests = %d, want 1", got)
	}
}
