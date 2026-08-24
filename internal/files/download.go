package files

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

const DesktopDownloadChunkWindowSize = chunkMetadataWindowSize

var ErrDirectDownloadUnavailable = errors.New("direct download is unavailable")

type DownloadChunk struct {
	Index     int
	Offset    int64
	SizeBytes int64
	SHA256    [32]byte
	URL       string
	ExpiresAt time.Time
}

func (s *Service) ResolveStoredDownloadChunks(ctx context.Context, file File, start, limit int, refresh bool) ([]DownloadChunk, error) {
	if file.ChunkSizeBytes <= 0 || start < 0 || limit < 1 || limit > DesktopDownloadChunkWindowSize {
		return nil, ErrStorageInvariant
	}
	chunkCount := 0
	if file.SizeBytes > 0 {
		chunkCount = int((file.SizeBytes + file.ChunkSizeBytes - 1) / file.ChunkSizeBytes)
	}
	if start > chunkCount {
		return nil, ErrStorageInvariant
	}
	if start == chunkCount {
		return []DownloadChunk{}, nil
	}
	end := start + limit
	if end > chunkCount {
		end = chunkCount
	}
	window, err := s.chunkWindow(ctx, file.ID, start, end)
	if err != nil {
		return nil, err
	}
	resolver, ok := s.blobs.(blobstore.AttachmentURLResolver)
	if !ok {
		return nil, ErrDirectDownloadUnavailable
	}
	refresher, canRefresh := s.blobs.(blobstore.AttachmentURLRefresher)
	result := make([]DownloadChunk, 0, len(window))
	for index, part := range window {
		var rawURL string
		var expiresAt time.Time
		if refresh && canRefresh {
			rawURL, expiresAt, err = refresher.RefreshAttachmentURL(ctx, part.Location)
		} else {
			rawURL, expiresAt, err = resolver.ResolveAttachmentURL(ctx, part.Location)
		}
		if err != nil {
			return nil, fmt.Errorf("resolve direct download chunk %d: %w", start+index, err)
		}
		if rawURL == "" {
			return nil, ErrDirectDownloadUnavailable
		}
		result = append(result, DownloadChunk{Index: start + index, Offset: int64(start+index) * file.ChunkSizeBytes, SizeBytes: part.SizeBytes, SHA256: part.SHA256, URL: rawURL, ExpiresAt: expiresAt})
	}
	return result, nil
}
