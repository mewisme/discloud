package discordstore

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"io"
	"mime/multipart"
	"testing"

	"github.com/mewisme/discloud/internal/blobstore"
)

func TestChunkRange(t *testing.T) {
	tests := []struct {
		offset int64
		length int64
		want   string
	}{
		{0, 0, ""},
		{10, 0, "bytes=10-"},
		{0, 10, "bytes=0-9"},
		{10, 20, "bytes=10-29"},
	}

	for _, tt := range tests {
		got := chunkRange(tt.offset, tt.length)
		if got != tt.want {
			t.Fatalf(
				"chunkRange(%d, %d) = %q, want %q",
				tt.offset,
				tt.length,
				got,
				tt.want,
			)
		}
	}
}

func TestWriteAttachmentMultipartRejectsWrongSize(t *testing.T) {
	data := []byte("hello")
	hash := sha256.Sum256(data)

	reader, writer := io.Pipe()
	multipartWriter := multipart.NewWriter(writer)
	result := make(chan chunkBodyResult, 1)

	go writeAttachmentMultipart(
		writer,
		multipartWriter,
		bytes.NewReader(data),
		int64(len(data)+1),
		hash,
		"test.chunk",
		result,
	)

	_, _ = io.Copy(io.Discard, reader)
	outcome := <-result

	if outcome.invariant == nil {
		t.Fatal("wrong size was accepted")
	}
}

func TestWriteAttachmentMultipartRejectsWrongHash(t *testing.T) {
	data := []byte("hello")
	wrongHash := sha256.Sum256([]byte("wrong"))

	reader, writer := io.Pipe()
	multipartWriter := multipart.NewWriter(writer)
	result := make(chan chunkBodyResult, 1)

	go writeAttachmentMultipart(
		writer,
		multipartWriter,
		bytes.NewReader(data),
		int64(len(data)),
		wrongHash,
		"test.chunk",
		result,
	)

	_, _ = io.Copy(io.Discard, reader)
	outcome := <-result

	if outcome.invariant == nil {
		t.Fatal("wrong hash was accepted")
	}
}

func TestNoUsableBotError(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	_, err := scheduler.Next([]string{"1"})
	if !errors.Is(err, blobstore.ErrNoUsableBot) {
		t.Fatalf("error = %v", err)
	}
}
