package thumbnails

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/files"
	"github.com/mewisme/discloud/internal/jobs"
	"github.com/mewisme/discloud/internal/media"
	"github.com/mewisme/discloud/internal/objects"
)

var (
	ErrNotFound = errors.New("thumbnail not found")
	ErrNotReady = errors.New("thumbnail not ready")
)

type Service struct {
	pool    *pgxpool.Pool
	files   *files.Service
	objects *objects.Service
}

type payload struct {
	FileID string `json:"fileId"`
}

func New(pool *pgxpool.Pool, fileService *files.Service, objectService *objects.Service) *Service {
	return &Service{pool: pool, files: fileService, objects: objectService}
}

// UploadFromClient stores a browser-generated thumbnail. The caller is
// responsible for permission checks; the input is re-validated here.
func (s *Service) UploadFromClient(ctx context.Context, fileID string, src io.Reader) (media.ProcessedImage, error) {
	if s == nil || s.pool == nil || s.objects == nil {
		return media.ProcessedImage{}, objects.ErrUnavailable
	}

	if _, err := s.pool.Exec(ctx, `
		INSERT INTO file_thumbnails (file_id, variant, status)
		VALUES ($1::uuid, 'grid', 'pending')
		ON CONFLICT (file_id, variant) DO NOTHING
	`, fileID); err != nil {
		return media.ProcessedImage{}, fmt.Errorf("ensure thumbnail row: %w", err)
	}

	processed, err := media.ProcessClientThumbnail(src)
	if err != nil {
		return media.ProcessedImage{}, err
	}

	object, err := s.objects.Put(ctx, "thumbnail", processed.Filename, processed.MIMEType, bytes.NewReader(processed.Data))
	if err != nil {
		return media.ProcessedImage{}, err
	}
	if err := s.finish(ctx, fileID, "ready", object.ID, processed.Width, processed.Height, ""); err != nil {
		return media.ProcessedImage{}, err
	}
	return processed, nil
}

func (s *Service) Handle(ctx context.Context, job jobs.Job) error {
	if s == nil || s.pool == nil || s.files == nil || s.objects == nil {
		return jobs.Permanent(errors.New("thumbnail service is unavailable"))
	}

	var input payload
	if err := json.Unmarshal(job.Payload, &input); err != nil {
		return jobs.Permanent(fmt.Errorf("decode thumbnail job: %w", err))
	}
	input.FileID = strings.TrimSpace(input.FileID)
	if input.FileID == "" {
		return jobs.Permanent(errors.New("thumbnail job has no fileId"))
	}

	status, err := s.status(ctx, input.FileID)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if status == "ready" || status == "skipped" {
		return nil
	}

	file, err := s.files.GetStored(ctx, input.FileID)
	if errors.Is(err, files.ErrNotFound) {
		return s.finish(ctx, input.FileID, "skipped", "", 0, 0, "file is not active")
	}
	if err != nil {
		return s.retryOrFail(ctx, job, input.FileID, err)
	}

	if file.Category != "image" && file.Category != "video" {
		return s.finish(ctx, file.ID, "skipped", "", 0, 0, "thumbnail is not supported for this file type")
	}
	if file.SizeBytes <= 0 {
		return s.finish(ctx, file.ID, "failed", "", 0, 0, "file is empty")
	}

	_, reader, err := s.files.OpenStored(ctx, file.ID, 0, file.SizeBytes)
	if err != nil {
		return s.retryOrFail(ctx, job, file.ID, err)
	}

	var processed media.ProcessedImage
	if file.Category == "image" {
		processed, err = media.ProcessImageThumbnail(reader)
	} else {
		processed, err = media.ProcessVideoThumbnail(ctx, reader)
	}
	closeErr := reader.Close()
	if err != nil {
		return s.retryOrFail(ctx, job, file.ID, err)
	}
	if closeErr != nil {
		return s.retryOrFail(ctx, job, file.ID, closeErr)
	}

	object, err := s.objects.Put(ctx, "thumbnail", processed.Filename, processed.MIMEType, bytes.NewReader(processed.Data))
	if err != nil {
		return s.retryOrFail(ctx, job, file.ID, err)
	}
	// ponytail: re-check narrows (not closes) the race where a client thumbnail
	// landed during FFmpeg work; worst case both are valid, client one wins.
	status, err = s.status(ctx, file.ID)
	if err == nil && (status == "ready" || status == "skipped") {
		return nil
	}
	if err := s.finish(ctx, file.ID, "ready", object.ID, processed.Width, processed.Height, ""); err != nil {
		return err
	}
	return nil
}

func (s *Service) ResolveURL(ctx context.Context, fileID string) (string, error) {
	if s == nil || s.pool == nil || s.objects == nil {
		return "", objects.ErrUnavailable
	}

	var status string
	var objectID *string
	err := s.pool.QueryRow(ctx, `
		SELECT status, object_id::text
		FROM file_thumbnails
		WHERE file_id = $1::uuid
		  AND variant = 'grid'
	`, fileID).Scan(&status, &objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("load thumbnail: %w", err)
	}
	if status != "ready" || objectID == nil || *objectID == "" {
		return "", ErrNotReady
	}
	return s.objects.ResolveURL(ctx, *objectID)
}

func (s *Service) status(ctx context.Context, fileID string) (string, error) {
	var status string
	err := s.pool.QueryRow(ctx, `
		SELECT status
		FROM file_thumbnails
		WHERE file_id = $1::uuid
		  AND variant = 'grid'
	`, fileID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("load thumbnail status: %w", err)
	}
	return status, nil
}

func (s *Service) retryOrFail(ctx context.Context, job jobs.Job, fileID string, cause error) error {
	if job.Attempts < job.MaxAttempts {
		return cause
	}
	if err := s.finish(ctx, fileID, "failed", "", 0, 0, truncateError(cause)); err != nil {
		return err
	}
	return nil
}

func (s *Service) finish(ctx context.Context, fileID, status, objectID string, width, height int, errorText string) error {
	var widthValue, heightValue any
	if width > 0 {
		widthValue = width
	}
	if height > 0 {
		heightValue = height
	}

	tag, err := s.pool.Exec(ctx, `
		UPDATE file_thumbnails
		SET object_id = NULLIF($3, '')::uuid,
		    status = $2,
		    width = $4,
		    height = $5,
		    error = NULLIF($6, ''),
		    updated_at = now()
		WHERE file_id = $1::uuid
		  AND variant = 'grid'
	`, fileID, status, objectID, widthValue, heightValue, errorText)
	if err != nil {
		return fmt.Errorf("update thumbnail: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}

func truncateError(err error) string {
	if err == nil {
		return ""
	}
	value := []rune(strings.TrimSpace(err.Error()))
	if len(value) > 1000 {
		value = value[:1000]
	}
	return string(value)
}
