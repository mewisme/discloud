package fake

import (
	"context"

	"github.com/mewisme/discloud/internal/blobstore"
)

func (s *Store) DeleteChunk(ctx context.Context, location blobstore.ChunkLocation) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if location.DiscordChannelID == "" || location.DiscordMessageID == "" {
		return blobstore.ErrInvalidChunk
	}

	s.mu.Lock()
	delete(s.blobs, locationKey(location))
	s.mu.Unlock()
	return nil
}
