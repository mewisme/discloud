package files

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/mewisme/discloud/internal/blobstore"
)

const chunkMetadataWindowSize = 16

var ErrStorageInvariant = errors.New("file storage invariant violated")

type chunk struct {
	SizeBytes int64
	SHA256    [32]byte
	Location  blobstore.ChunkLocation
}

type chunkSource interface {
	chunkWindow(context.Context, string, int, int) ([]chunk, error)
}

type rangeReader struct {
	ctx              context.Context
	source           chunkSource
	blobs            blobstore.BlobStore
	fileID           string
	chunkSize        int64
	position         int64
	remaining        int64
	current          io.ReadCloser
	currentRemaining int64
	windowStart      int
	window           []chunk
}

func newRangeReader(ctx context.Context, source chunkSource, blobs blobstore.BlobStore, fileID string, chunkSize, start, length int64) (*rangeReader, error) {
	r := &rangeReader{
		ctx: ctx, source: source, blobs: blobs, fileID: fileID,
		chunkSize: chunkSize, position: start, remaining: length,
	}
	if length > 0 {
		if err := r.openCurrent(); err != nil {
			return nil, err
		}
	}
	return r, nil
}

func (r *rangeReader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if r.remaining == 0 {
		return 0, io.EOF
	}

	for {
		if r.current == nil {
			if err := r.openCurrent(); err != nil {
				return 0, err
			}
		}

		limit := int64(len(p))
		if limit > r.remaining {
			limit = r.remaining
		}
		if limit > r.currentRemaining {
			limit = r.currentRemaining
		}

		n, err := r.current.Read(p[:int(limit)])
		r.position += int64(n)
		r.remaining -= int64(n)
		r.currentRemaining -= int64(n)

		prematureEOF := errors.Is(err, io.EOF) && r.currentRemaining > 0
		if r.currentRemaining == 0 {
			closeErr := r.current.Close()
			r.current = nil
			if err == nil {
				err = closeErr
			}
		}
		if prematureEOF {
			return n, ErrStorageInvariant
		}
		if err != nil && !errors.Is(err, io.EOF) {
			return n, err
		}
		if n > 0 {
			return n, nil
		}
		if r.remaining == 0 {
			return 0, io.EOF
		}
	}
}

func (r *rangeReader) Close() error {
	r.window = nil
	if r.current == nil {
		return nil
	}
	err := r.current.Close()
	r.current = nil
	return err
}

func (r *rangeReader) openCurrent() error {
	if err := r.ctx.Err(); err != nil {
		return err
	}
	if r.chunkSize <= 0 {
		return ErrStorageInvariant
	}

	partIndex := int(r.position / r.chunkSize)
	part, err := r.chunkFor(partIndex)
	if err != nil {
		return err
	}

	offset := r.position - int64(partIndex)*r.chunkSize
	if offset < 0 || offset >= part.SizeBytes {
		return ErrStorageInvariant
	}

	length := part.SizeBytes - offset
	if length > r.remaining {
		length = r.remaining
	}

	blobLength := length
	if offset == 0 && length == part.SizeBytes {
		blobLength = 0
	}

	reader, err := r.blobs.OpenChunk(r.ctx, part.Location, offset, blobLength)
	if err != nil {
		return err
	}

	r.current = reader
	r.currentRemaining = length
	return nil
}

func (r *rangeReader) chunkFor(partIndex int) (chunk, error) {
	if len(r.window) > 0 && partIndex >= r.windowStart && partIndex < r.windowStart+len(r.window) {
		return r.window[partIndex-r.windowStart], nil
	}

	lastPartIndex := int((r.position + r.remaining - 1) / r.chunkSize)
	windowEnd := partIndex + chunkMetadataWindowSize
	if windowEnd > lastPartIndex+1 {
		windowEnd = lastPartIndex + 1
	}

	window, err := r.source.chunkWindow(r.ctx, r.fileID, partIndex, windowEnd)
	if err != nil {
		return chunk{}, err
	}
	if len(window) != windowEnd-partIndex {
		return chunk{}, fmt.Errorf(
			"%w: chunk metadata window %d-%d returned %d parts",
			ErrStorageInvariant,
			partIndex,
			windowEnd-1,
			len(window),
		)
	}

	r.windowStart = partIndex
	r.window = window
	return window[0], nil
}

func (s *Service) chunkWindow(ctx context.Context, fileID string, start, end int) ([]chunk, error) {
	if start < 0 || end <= start {
		return nil, ErrStorageInvariant
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			fc.part_index,
			fc.part_size_bytes,
			c.sha256,
			c.discord_channel_id,
			c.discord_message_id,
			c.discord_attachment_id
		FROM file_chunks fc
		JOIN chunks c ON c.id = fc.chunk_id
		WHERE fc.file_id = $1::uuid
		  AND fc.part_index >= $2
		  AND fc.part_index < $3
		  AND c.status = 'ready'
		ORDER BY fc.part_index
	`, fileID, start, end)
	if err != nil {
		return nil, fmt.Errorf("%w: load chunk metadata window %d-%d: %v", ErrStorageInvariant, start, end-1, err)
	}
	defer rows.Close()

	window := make([]chunk, 0, end-start)
	expectedIndex := start

	for rows.Next() {
		var partIndex int
		var part chunk
		var sha256 []byte

		if err := rows.Scan(
			&partIndex,
			&part.SizeBytes,
			&sha256,
			&part.Location.DiscordChannelID,
			&part.Location.DiscordMessageID,
			&part.Location.DiscordAttachmentID,
		); err != nil {
			return nil, fmt.Errorf("%w: scan chunk metadata window: %v", ErrStorageInvariant, err)
		}
		if partIndex != expectedIndex {
			return nil, fmt.Errorf("%w: expected chunk %d, got %d", ErrStorageInvariant, expectedIndex, partIndex)
		}
		if len(sha256) != len(part.SHA256) {
			return nil, fmt.Errorf("%w: chunk %d has invalid SHA-256", ErrStorageInvariant, partIndex)
		}
		copy(part.SHA256[:], sha256)

		window = append(window, part)
		expectedIndex++
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: read chunk metadata window: %v", ErrStorageInvariant, err)
	}
	if expectedIndex != end {
		return nil, fmt.Errorf("%w: missing chunk %d", ErrStorageInvariant, expectedIndex)
	}

	return window, nil
}
