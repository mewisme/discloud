package blobstore

import (
	"context"
	"errors"
	"io"
	"time"
)

var (
	ErrNoUsableBot  = errors.New("no usable storage bot")
	ErrInvalidChunk = errors.New("invalid chunk")
)

type Location struct {
	DiscordChannelID    string
	DiscordMessageID    string
	DiscordAttachmentID string
}

type ChunkLocation = Location

type PutResult struct {
	Location  Location
	BotUserID string
}

type ClassifiedError interface {
	error
	StorageClass() string
	StorageRetryable() bool
}

type BlobStore interface {
	PutChunk(ctx context.Context, excludedBotUserIDs []string, r io.Reader, size int64, sha256 [32]byte) (PutResult, error)
	OpenChunk(ctx context.Context, location ChunkLocation, offset, length int64) (io.ReadCloser, error)
}

type AttemptBlobStore interface {
	BlobStore
	SelectUploadBot(excludedBotUserIDs []string) (string, error)
	PutChunkWithBot(ctx context.Context, botUserID string, r io.Reader, size int64, sha256 [32]byte) (PutResult, error)
}

type UploadLeaseStore interface {
	AcquireUploadBot(ctx context.Context, excludedBotUserIDs []string) (botUserID string, release func(), err error)
}

type DirectObjectStore interface {
	UploadLeaseStore
	PutObject(ctx context.Context, filename string, r io.ReadSeeker, size int64, sha256 [32]byte) (PutResult, error)
	ResolveAttachmentURL(ctx context.Context, location Location) (rawURL string, expiresAt time.Time, err error)
	DeleteObject(ctx context.Context, location Location) error
}

type TechnicalBlobStore interface {
	DeleteChunk(ctx context.Context, location ChunkLocation) error
}

func Classify(err error) (string, bool) {
	var classified ClassifiedError
	if errors.As(err, &classified) {
		return classified.StorageClass(), classified.StorageRetryable()
	}
	return "unknown", false
}
