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

type fakeChunkSource struct {
	parts   map[int]chunk
	windows [][2]int
}

func (s *fakeChunkSource) chunkWindow(_ context.Context, _ string, start, end int) ([]chunk, error) {
	s.windows = append(s.windows, [2]int{start, end})

	result := make([]chunk, 0, end-start)
	for index := start; index < end; index++ {
		part, ok := s.parts[index]
		if !ok {
			return nil, ErrStorageInvariant
		}
		result = append(result, part)
	}
	return result, nil
}

func TestRangeReaderAcrossChunks(t *testing.T) {
	ctx := context.Background()
	store := fake.New("bot-a")
	source := &fakeChunkSource{parts: map[int]chunk{}}

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
		source.parts[i] = chunk{SizeBytes: int64(len(data)), Location: put.Location}
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

func TestRangeReaderPrefetchesChunkMetadataWindows(t *testing.T) {
	ctx := context.Background()
	store := fake.New("bot-a")
	source := &fakeChunkSource{parts: map[int]chunk{}}

	const chunkCount = 40
	const chunkSize = 10

	var expected bytes.Buffer
	for index := 0; index < chunkCount; index++ {
		data := bytes.Repeat([]byte{byte('a' + index%26)}, chunkSize)
		expected.Write(data)

		digest := sha256.Sum256(data)
		put, err := store.PutChunk(ctx, nil, bytes.NewReader(data), int64(len(data)), digest)
		if err != nil {
			t.Fatalf("seed chunk %d: %v", index, err)
		}
		source.parts[index] = chunk{SizeBytes: int64(len(data)), Location: put.Location}
	}

	reader, err := newRangeReader(ctx, source, store, "file", chunkSize, 0, chunkCount*chunkSize)
	if err != nil {
		t.Fatalf("newRangeReader(): %v", err)
	}

	if len(source.windows) != 1 {
		t.Fatalf("metadata windows after open = %d, want 1", len(source.windows))
	}
	if source.windows[0] != [2]int{0, chunkMetadataWindowSize} {
		t.Fatalf("first metadata window = %v, want [0 %d]", source.windows[0], chunkMetadataWindowSize)
	}

	got, err := io.ReadAll(reader)
	reader.Close()
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	if !bytes.Equal(got, expected.Bytes()) {
		t.Fatal("read file content does not match")
	}

	wantWindows := [][2]int{
		{0, 16},
		{16, 32},
		{32, 40},
	}
	if len(source.windows) != len(wantWindows) {
		t.Fatalf("metadata window queries = %d, want %d: %v", len(source.windows), len(wantWindows), source.windows)
	}
	for index, want := range wantWindows {
		if source.windows[index] != want {
			t.Fatalf("metadata window %d = %v, want %v", index, source.windows[index], want)
		}
	}
}

func TestRangeReaderClipsMetadataWindowToRequestedRange(t *testing.T) {
	ctx := context.Background()
	store := fake.New("bot-a")
	source := &fakeChunkSource{parts: map[int]chunk{}}

	for index := 0; index < 32; index++ {
		data := bytes.Repeat([]byte{byte(index)}, 10)
		digest := sha256.Sum256(data)

		put, err := store.PutChunk(ctx, nil, bytes.NewReader(data), int64(len(data)), digest)
		if err != nil {
			t.Fatalf("seed chunk %d: %v", index, err)
		}
		source.parts[index] = chunk{SizeBytes: int64(len(data)), Location: put.Location}
	}

	reader, err := newRangeReader(ctx, source, store, "file", 10, 205, 3)
	if err != nil {
		t.Fatalf("newRangeReader(): %v", err)
	}
	defer reader.Close()

	if len(source.windows) != 1 {
		t.Fatalf("metadata window queries = %d, want 1", len(source.windows))
	}
	if source.windows[0] != [2]int{20, 21} {
		t.Fatalf("metadata window = %v, want [20 21]", source.windows[0])
	}

	got, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read range: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("range length = %d, want 3", len(got))
	}
}

func TestRangeReaderRejectsMissingChunkInsideWindow(t *testing.T) {
	ctx := context.Background()
	store := fake.New("bot-a")
	source := &fakeChunkSource{parts: map[int]chunk{}}

	for index := 0; index < 3; index++ {
		if index == 1 {
			continue
		}

		data := bytes.Repeat([]byte{byte(index)}, 10)
		digest := sha256.Sum256(data)
		put, err := store.PutChunk(ctx, nil, bytes.NewReader(data), int64(len(data)), digest)
		if err != nil {
			t.Fatalf("seed chunk %d: %v", index, err)
		}
		source.parts[index] = chunk{SizeBytes: int64(len(data)), Location: put.Location}
	}

	_, err := newRangeReader(ctx, source, store, "file", 10, 0, 30)
	if !errors.Is(err, ErrStorageInvariant) {
		t.Fatalf("error = %v, want ErrStorageInvariant", err)
	}
}

func TestRangeReaderPropagatesCancellation(t *testing.T) {
	store := fake.New()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := newRangeReader(ctx, &fakeChunkSource{
		parts: map[int]chunk{
			0: {SizeBytes: 5, Location: blobstore.ChunkLocation{}},
		},
	}, store, "file", 10, 0, 5)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
}
