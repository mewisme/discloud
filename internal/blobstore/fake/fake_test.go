package fake

import (
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/mewisme/discloud/internal/blobstore"
)

func TestStoreRoundTrip(t *testing.T) {
	store := New("bot-a", "bot-b")
	data := []byte("hello world")
	digest := sha256.Sum256(data)

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
		t.Fatalf("bot = %q, want bot-a", put.BotUserID)
	}

	reader, err := store.OpenChunk(
		context.Background(),
		put.Location,
		6,
		5,
	)
	if err != nil {
		t.Fatalf("OpenChunk() error: %v", err)
	}
	defer reader.Close()

	got, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read chunk: %v", err)
	}
	if string(got) != "world" {
		t.Fatalf("chunk = %q, want world", got)
	}

	second, err := store.PutChunk(
		context.Background(),
		[]string{"bot-b"},
		strings.NewReader(string(data)),
		int64(len(data)),
		digest,
	)
	if err != nil {
		t.Fatalf("second PutChunk() error: %v", err)
	}
	if second.BotUserID != "bot-a" {
		t.Fatalf("excluded selection = %q, want bot-a", second.BotUserID)
	}
}

func TestStoreRejectsInvalidChunk(t *testing.T) {
	store := New()
	data := []byte("hello")
	wrong := sha256.Sum256([]byte("wrong"))

	_, err := store.PutChunk(
		context.Background(),
		nil,
		strings.NewReader(string(data)),
		int64(len(data)),
		wrong,
	)
	if !errors.Is(err, blobstore.ErrInvalidChunk) {
		t.Fatalf("PutChunk() error = %v", err)
	}
}

func TestStoreNoUsableBot(t *testing.T) {
	store := New("bot-a")

	data := []byte("hello")
	digest := sha256.Sum256(data)

	_, err := store.PutChunk(
		context.Background(),
		[]string{"bot-a"},
		strings.NewReader(string(data)),
		int64(len(data)),
		digest,
	)
	if !errors.Is(err, blobstore.ErrNoUsableBot) {
		t.Fatalf("PutChunk() error = %v", err)
	}
}
