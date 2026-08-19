package fake

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"strconv"
	"sync"

	"github.com/mewisme/discloud/internal/blobstore"
)

type Store struct {
	mu       sync.Mutex
	bots     []string
	nextBot  int
	sequence uint64
	blobs    map[string][]byte
	failures map[string][]error
}

func New(botUserIDs ...string) *Store {
	if len(botUserIDs) == 0 {
		botUserIDs = []string{"fake-bot"}
	}
	return &Store{
		bots:     append([]string(nil), botUserIDs...),
		blobs:    make(map[string][]byte),
		failures: make(map[string][]error),
	}
}

func (s *Store) FailNext(botUserID string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failures[botUserID] = append(s.failures[botUserID], err)
}

func (s *Store) SelectUploadBot(excluded []string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nextUsableBot(excluded)
}

func (s *Store) PutChunk(ctx context.Context, excluded []string, r io.Reader, size int64, expectedSHA256 [32]byte) (blobstore.PutResult, error) {
	botUserID, err := s.SelectUploadBot(excluded)
	if err != nil {
		return blobstore.PutResult{}, err
	}
	return s.PutChunkWithBot(ctx, botUserID, r, size, expectedSHA256)
}

func (s *Store) PutChunkWithBot(ctx context.Context, botUserID string, r io.Reader, size int64, expectedSHA256 [32]byte) (blobstore.PutResult, error) {
	if err := ctx.Err(); err != nil {
		return blobstore.PutResult{}, err
	}
	if size <= 0 {
		return blobstore.PutResult{}, blobstore.ErrInvalidChunk
	}

	s.mu.Lock()
	if !s.hasBot(botUserID) {
		s.mu.Unlock()
		return blobstore.PutResult{}, fmt.Errorf("%w: %s", blobstore.ErrNoUsableBot, botUserID)
	}
	if failures := s.failures[botUserID]; len(failures) > 0 {
		err := failures[0]
		s.failures[botUserID] = failures[1:]
		s.mu.Unlock()
		return blobstore.PutResult{}, err
	}
	s.mu.Unlock()

	data, err := io.ReadAll(io.LimitReader(r, size+1))
	if err != nil {
		return blobstore.PutResult{}, err
	}
	if int64(len(data)) != size || sha256.Sum256(data) != expectedSHA256 {
		return blobstore.PutResult{}, blobstore.ErrInvalidChunk
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.sequence++
	id := strconv.FormatUint(s.sequence, 10)
	location := blobstore.ChunkLocation{
		DiscordChannelID:    "fake-channel",
		DiscordMessageID:    id,
		DiscordAttachmentID: id,
	}
	s.blobs[locationKey(location)] = append([]byte(nil), data...)
	return blobstore.PutResult{Location: location, BotUserID: botUserID}, nil
}

func (s *Store) OpenChunk(ctx context.Context, location blobstore.ChunkLocation, offset, length int64) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if offset < 0 || length < 0 {
		return nil, blobstore.ErrInvalidChunk
	}

	s.mu.Lock()
	data, exists := s.blobs[locationKey(location)]
	data = append([]byte(nil), data...)
	s.mu.Unlock()

	if !exists {
		return nil, fmt.Errorf("fake chunk not found")
	}

	size := int64(len(data))
	if offset > size {
		return nil, blobstore.ErrInvalidChunk
	}

	end := size
	if length > 0 {
		if length > size-offset {
			return nil, blobstore.ErrInvalidChunk
		}
		end = offset + length
	}

	return io.NopCloser(bytes.NewReader(data[offset:end])), nil
}

func (s *Store) nextUsableBot(excludedBotUserIDs []string) (string, error) {
	excluded := make(map[string]struct{}, len(excludedBotUserIDs))
	for _, id := range excludedBotUserIDs {
		excluded[id] = struct{}{}
	}

	for i := 0; i < len(s.bots); i++ {
		index := (s.nextBot + i) % len(s.bots)
		id := s.bots[index]
		if _, skip := excluded[id]; skip {
			continue
		}
		s.nextBot = (index + 1) % len(s.bots)
		return id, nil
	}

	return "", blobstore.ErrNoUsableBot
}

func (s *Store) hasBot(userID string) bool {
	for _, bot := range s.bots {
		if bot == userID {
			return true
		}
	}
	return false
}

func locationKey(location blobstore.ChunkLocation) string {
	return location.DiscordChannelID + "/" + location.DiscordMessageID + "/" + location.DiscordAttachmentID
}
