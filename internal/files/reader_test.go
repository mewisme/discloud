package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"testing"

	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/blobstore/fake"
)

type fakeChunkSource map[int]chunk

func (s fakeChunkSource) chunkAt(_ context.Context, _ string, index int) (chunk, error) {
	part, ok := s[index]
	if !ok {
		return chunk{}, ErrStorageInvariant
	}
	return part, nil
}

func TestRangeReaderAcrossChunks(t *testing.T) {
	ctx := context.Background()
	store := fake.New("bot-a")
	source := fakeChunkSource{}

	for i, data := range [][]byte{
		[]byte("abcdefghij"),
		[]byte("klmnopqrst"),
		[]byte("uvwxy"),
	} {
		digest := sha256.Sum256(data)
		put, err := store.PutChunk(ctx, nil, bytes.NewReader(data), int64(len(data)), digest)
		if err != nil {
			t.Fatalf("seed chunk %d: %v", i, err)
		}
		source[i] = chunk{SizeBytes: int64(len(data)), Location: put.Location}
	}

	tests := []struct {
		start  int64
		length int64
		want   string
	}{
		{0, 25, "abcdefghijklmnopqrstuvwxy"},
		{8, 10, "ijklmnopqr"},
		{9, 12, "jklmnopqrstu"},
		{20, 5, "uvwxy"},
	}

	for _, tt := range tests {
		reader, err := newRangeReader(ctx, source, store, "file", 10, tt.start, tt.length)
		if err != nil {
			t.Fatalf("newRangeReader(%d,%d): %v", tt.start, tt.length, err)
		}

		got, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatalf("read range: %v", err)
		}
		if string(got) != tt.want {
			t.Fatalf("range %d+%d = %q, want %q", tt.start, tt.length, got, tt.want)
		}
	}
}

func TestRangeReaderPropagatesCancellation(t *testing.T) {
	store := fake.New()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := newRangeReader(ctx, fakeChunkSource{
		0: {SizeBytes: 5, Location: blobstore.ChunkLocation{}},
	}, store, "file", 10, 0, 5)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
}
