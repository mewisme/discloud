package folders

import (
	"archive/zip"
	"context"
	"fmt"
	"io"

	"github.com/mewisme/discloud/internal/files"
)

type archiveOpener func(string, int64) (io.ReadCloser, error)

func (s *Service) WriteZIP(ctx context.Context, actor Actor, archive Archive, dst io.Writer) error {
	return s.writeZIP(ctx, archive, dst, func(fileID string, size int64) (io.ReadCloser, error) {
		_, reader, err := s.files.Open(
			ctx,
			files.Actor{UserID: actor.UserID, Admin: actor.Admin},
			fileID,
			0,
			size,
		)
		return reader, err
	})
}

// WriteZIPStored skips ACL; caller must authorize another access context first.
func (s *Service) WriteZIPStored(ctx context.Context, archive Archive, dst io.Writer) error {
	if s.stored == nil {
		return ErrArchiveInvariant
	}

	return s.writeZIP(ctx, archive, dst, func(fileID string, size int64) (io.ReadCloser, error) {
		_, reader, err := s.stored.OpenStored(ctx, fileID, 0, size)
		return reader, err
	})
}

func (s *Service) writeZIP(ctx context.Context, archive Archive, dst io.Writer, open archiveOpener) error {
	writer := zip.NewWriter(dst)

	fail := func(err error) error {
		_ = writer.Close()
		return err
	}

	for _, entry := range archive.Entries {
		if err := ctx.Err(); err != nil {
			return fail(err)
		}

		name := entry.Path
		if entry.Kind == "folder" {
			name += "/"
		}

		header := &zip.FileHeader{Name: name, Method: zip.Store}
		if !entry.CreatedAt.IsZero() {
			header.SetModTime(entry.CreatedAt)
		}

		target, err := writer.CreateHeader(header)
		if err != nil {
			return fail(fmt.Errorf("create ZIP entry: %w", err))
		}
		if entry.Kind == "folder" {
			continue
		}

		reader, err := open(entry.NodeID, entry.SizeBytes)
		if err != nil {
			return fail(err)
		}

		n, copyErr := io.Copy(target, reader)
		closeErr := reader.Close()
		if copyErr != nil {
			return fail(fmt.Errorf("stream ZIP entry: %w", copyErr))
		}
		if closeErr != nil {
			return fail(fmt.Errorf("close ZIP entry source: %w", closeErr))
		}
		if n != entry.SizeBytes {
			return fail(ErrArchiveInvariant)
		}
	}

	if err := writer.Close(); err != nil {
		return fmt.Errorf("close ZIP archive: %w", err)
	}
	return nil
}
