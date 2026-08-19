package discordstore

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

func TestStoreHTTPRoundTrip(t *testing.T) {
	data := []byte("hello")
	digest := sha256.Sum256(data)

	var (
		server          *httptest.Server
		mu              sync.Mutex
		downloadBotAuth string
	)

	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/users/@me":
			switch r.Header.Get("Authorization") {
			case "Bot token-a":
				writeJSON(t, w, User{ID: "bot-a", Bot: true})
			case "Bot token-b":
				writeJSON(t, w, User{ID: "bot-b", Bot: true})
			default:
				http.Error(w, "unauthorized", http.StatusUnauthorized)
			}

		case r.Method == http.MethodPost &&
			r.URL.Path == "/channels/channel-1/messages":
			if r.Header.Get("Authorization") != "Bot token-a" {
				http.Error(w, "wrong upload bot", http.StatusForbidden)
				return
			}

			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Errorf("ParseMultipartForm(): %v", err)
				http.Error(w, "bad multipart", http.StatusBadRequest)
				return
			}

			var payload struct {
				Attachments []struct {
					ID       int    `json:"id"`
					Filename string `json:"filename"`
				} `json:"attachments"`
			}

			if err := json.Unmarshal(
				[]byte(r.FormValue("payload_json")),
				&payload,
			); err != nil {
				t.Errorf("decode payload_json: %v", err)
				http.Error(w, "bad payload", http.StatusBadRequest)
				return
			}

			if len(payload.Attachments) != 1 ||
				payload.Attachments[0].ID != 0 {
				t.Errorf("attachments = %+v", payload.Attachments)
			}

			file, _, err := r.FormFile("files[0]")
			if err != nil {
				t.Errorf("FormFile(): %v", err)
				http.Error(w, "missing file", http.StatusBadRequest)
				return
			}
			defer file.Close()

			got, err := io.ReadAll(file)
			if err != nil {
				t.Errorf("read uploaded file: %v", err)
				http.Error(w, "read error", http.StatusInternalServerError)
				return
			}
			if string(got) != string(data) {
				t.Errorf("uploaded data = %q, want %q", got, data)
			}

			writeJSON(t, w, Message{
				ID:        "message-1",
				ChannelID: "channel-1",
				Attachments: []Attachment{
					{
						ID:   "attachment-1",
						Size: int64(len(data)),
						URL:  server.URL + "/attachment/attachment-1",
					},
				},
			})

		case r.Method == http.MethodGet &&
			r.URL.Path == "/channels/channel-1/messages/message-1":
			mu.Lock()
			downloadBotAuth = r.Header.Get("Authorization")
			mu.Unlock()

			writeJSON(t, w, Message{
				ID:        "message-1",
				ChannelID: "channel-1",
				Attachments: []Attachment{
					{
						ID:   "attachment-1",
						Size: int64(len(data)),
						URL:  server.URL + "/attachment/attachment-1",
					},
				},
			})

		case r.Method == http.MethodGet &&
			r.URL.Path == "/attachment/attachment-1":
			if r.Header.Get("Authorization") != "" {
				t.Errorf("CDN request unexpectedly authenticated")
			}
			if r.Header.Get("Range") != "bytes=1-3" {
				t.Errorf(
					"Range = %q, want bytes=1-3",
					r.Header.Get("Range"),
				)
			}

			w.Header().Set("Content-Range", "bytes 1-3/5")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(data[1:4])

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClientWithBaseURL(server.Client(), server.URL)

	store, err := NewWithClient(
		context.Background(),
		"channel-1",
		[]string{"token-a", "token-b"},
		client,
	)
	if err != nil {
		t.Fatalf("NewWithClient() error: %v", err)
	}

	put, err := store.PutChunk(
		context.Background(),
		nil,
		strings.NewReader(string(data)),
		int64(len(data)),
		digest,
	)
	if err != nil {
		t.Fatalf("PutChunk() error: %v", err)
	}

	if put.BotUserID != "bot-a" {
		t.Fatalf("upload bot = %q, want bot-a", put.BotUserID)
	}
	if put.Location != (blobstore.ChunkLocation{
		DiscordChannelID:    "channel-1",
		DiscordMessageID:    "message-1",
		DiscordAttachmentID: "attachment-1",
	}) {
		t.Fatalf("location = %+v", put.Location)
	}

	reader, err := store.OpenChunk(
		context.Background(),
		put.Location,
		1,
		3,
	)
	if err != nil {
		t.Fatalf("OpenChunk() error: %v", err)
	}
	defer reader.Close()

	got, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read OpenChunk(): %v", err)
	}
	if string(got) != "ell" {
		t.Fatalf("range data = %q, want ell", got)
	}

	mu.Lock()
	auth := downloadBotAuth
	mu.Unlock()

	if auth != "Bot token-b" {
		t.Fatalf(
			"download auth = %q, want Bot token-b",
			auth,
		)
	}
}

func TestStoreRateLimitCooldown(t *testing.T) {
	data := []byte("hello")
	digest := sha256.Sum256(data)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/users/@me":
			writeJSON(t, w, User{
				ID:  "bot-a",
				Bot: true,
			})

		case r.Method == http.MethodPost &&
			r.URL.Path == "/channels/channel-1/messages":
			_, _ = io.Copy(io.Discard, r.Body)

			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "0.25")
			w.WriteHeader(http.StatusTooManyRequests)

			_ = json.NewEncoder(w).Encode(struct {
				Message    string  `json:"message"`
				RetryAfter float64 `json:"retry_after"`
				Global     bool    `json:"global"`
			}{
				Message:    "rate limited",
				RetryAfter: 0.25,
			})

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClientWithBaseURL(server.Client(), server.URL)

	store, err := NewWithClient(
		context.Background(),
		"channel-1",
		[]string{"token-a"},
		client,
	)
	if err != nil {
		t.Fatalf("NewWithClient() error: %v", err)
	}

	_, err = store.PutChunk(
		context.Background(),
		nil,
		strings.NewReader(string(data)),
		int64(len(data)),
		digest,
	)

	var upstream *UpstreamError
	if !errors.As(err, &upstream) {
		t.Fatalf("PutChunk() error = %T %v", err, err)
	}
	if upstream.Class != ErrorRateLimited {
		t.Fatalf("class = %q, want %q", upstream.Class, ErrorRateLimited)
	}
	if !upstream.Retryable {
		t.Fatal("429 was not classified retryable")
	}
	if upstream.RetryAfter != 250*time.Millisecond {
		t.Fatalf(
			"RetryAfter = %s, want %s",
			upstream.RetryAfter,
			250*time.Millisecond,
		)
	}

	_, err = store.PutChunk(
		context.Background(),
		nil,
		strings.NewReader(string(data)),
		int64(len(data)),
		digest,
	)
	if !errors.Is(err, blobstore.ErrNoUsableBot) {
		t.Fatalf("second PutChunk() = %v", err)
	}
}

func writeJSON(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Errorf("write JSON: %v", err)
	}
}
