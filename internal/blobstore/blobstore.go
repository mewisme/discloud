package blobstore

import (
	"context"
	"errors"
	"io"
)

var (
	ErrNoUsableBot  = errors.New("no usable storage bot")
	ErrInvalidChunk = errors.New("invalid chunk")
)

type ChunkLocation struct {
	DiscordChannelID    string
	DiscordMessageID    string
	DiscordAttachmentID string
}

type PutResult struct {
	Location  ChunkLocation
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
