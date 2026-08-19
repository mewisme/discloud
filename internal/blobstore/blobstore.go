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

type BlobStore interface {
	PutChunk(
		ctx context.Context,
		excludedBotUserIDs []string,
		r io.Reader,
		size int64,
		sha256 [32]byte,
	) (PutResult, error)

	OpenChunk(
		ctx context.Context,
		location ChunkLocation,
		offset int64,
		length int64,
	) (io.ReadCloser, error)
}
