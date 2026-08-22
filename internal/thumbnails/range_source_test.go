package thumbnails

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/files"
)

func TestVideoRangeSourceServesByteRange(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	data := []byte("0123456789")
	file := files.File{
		ID:        "file-1",
		Name:      "video.mp4",
		SizeBytes: int64(len(data)),
		MIMEType:  "video/mp4",
		UpdatedAt: time.Now(),
	}

	source, err := newVideoRangeSource(
		ctx,
		&fakeStoredRangeOpener{data: data},
		file,
		1024,
	)
	if err != nil {
		t.Fatalf("newVideoRangeSource(): %v", err)
	}
	defer func() {
		if err := source.Close(); err != nil {
			t.Errorf("close source: %v", err)
		}
	}()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, source.URL(), nil)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	request.Header.Set("Range", "bytes=2-5")

	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("GET range: %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusPartialContent)
	}
	if value := response.Header.Get("Content-Range"); value != "bytes 2-5/10" {
		t.Fatalf("Content-Range = %q, want %q", value, "bytes 2-5/10")
	}

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read range: %v", err)
	}
	if string(body) != "2345" {
		t.Fatalf("body = %q, want %q", body, "2345")
	}
}

func TestVideoRangeSeekerEnforcesReadBudget(t *testing.T) {
	data := []byte("0123456789")
	budget := newReadBudget(3)
	limitHit := &atomic.Bool{}

	seeker := &videoRangeSeeker{
		ctx:      context.Background(),
		opener:   &fakeStoredRangeOpener{data: data},
		file:     files.File{ID: "file-1", SizeBytes: int64(len(data))},
		budget:   budget,
		limitHit: limitHit,
	}
	defer seeker.Close()

	buffer := make([]byte, 5)
	n, err := seeker.Read(buffer)
	if err != nil {
		t.Fatalf("first Read(): %v", err)
	}
	if n != 3 {
		t.Fatalf("first Read() = %d bytes, want 3", n)
	}
	if string(buffer[:n]) != "012" {
		t.Fatalf("first Read() = %q, want %q", buffer[:n], "012")
	}

	n, err = seeker.Read(buffer)
	if n != 0 {
		t.Fatalf("second Read() = %d bytes, want 0", n)
	}
	if !errors.Is(err, errVideoThumbnailReadBudget) {
		t.Fatalf("second Read() error = %v, want read budget error", err)
	}
	if !limitHit.Load() {
		t.Fatal("read budget exhaustion was not recorded")
	}
}

type fakeStoredRangeOpener struct {
	data []byte
}

func (f *fakeStoredRangeOpener) OpenStored(_ context.Context, _ string, start, length int64) (files.File, io.ReadCloser, error) {
	size := int64(len(f.data))
	if start < 0 || length < 0 || start > size || length > size-start {
		return files.File{}, nil, files.ErrInvalidSpan
	}

	return files.File{}, io.NopCloser(
		bytes.NewReader(f.data[start : start+length]),
	), nil
}
