package files

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/mewisme/discloud/internal/blobstore"
)

var ErrStorageInvariant = errors.New("file storage invariant violated")

type chunk struct {
	SizeBytes int64
	Location  blobstore.ChunkLocation
}

type chunkSource interface {
	chunkAt(context.Context, string, int) (chunk, error)
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
	part, err := r.source.chunkAt(r.ctx, r.fileID, partIndex)
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

func (s *Service) chunkAt(ctx context.Context, fileID string, partIndex int) (chunk, error) {
	var part chunk
	err := s.pool.QueryRow(ctx, `
		SELECT
			fc.part_size_bytes,
			c.discord_channel_id,
			c.discord_message_id,
			c.discord_attachment_id
		FROM file_chunks fc
		JOIN chunks c ON c.id = fc.chunk_id
		WHERE fc.file_id::text = $1
		  AND fc.part_index = $2
		  AND c.status = 'ready'
	`, fileID, partIndex).Scan(
		&part.SizeBytes,
		&part.Location.DiscordChannelID,
		&part.Location.DiscordMessageID,
		&part.Location.DiscordAttachmentID,
	)
	if err != nil {
		return chunk{}, fmt.Errorf("%w: chunk %d: %v", ErrStorageInvariant, partIndex, err)
	}
	return part, nil
}
