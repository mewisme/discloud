package files

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/jackc/pgx/v5"
	_ "golang.org/x/image/webp"

	"github.com/mewisme/discloud/internal/jobs"
	"github.com/mewisme/discloud/internal/postgres"
)

const sniffBytes = 512

type MetadataProcessor struct {
	service *Service
}

type metadataPayload struct {
	FileID       string `json:"fileId"`
	MIMETypeHint string `json:"mimeTypeHint"`
}

type metadataOutcome struct {
	MIMEType  string
	Extension string
	Category  string
	Width     *int
	Height    *int
	Metadata  map[string]any
	Status    string
	Error     string
}

func NewMetadataProcessor(service *Service) *MetadataProcessor {
	return &MetadataProcessor{service: service}
}

func (p *MetadataProcessor) Handle(ctx context.Context, job jobs.Job) error {
	if p == nil || p.service == nil {
		return jobs.Permanent(errors.New("file metadata service is unavailable"))
	}

	var payload metadataPayload
	if err := json.Unmarshal(job.Payload, &payload); err != nil {
		return jobs.Permanent(fmt.Errorf("decode file metadata job: %w", err))
	}
	payload.FileID = strings.TrimSpace(payload.FileID)
	if payload.FileID == "" {
		return jobs.Permanent(errors.New("file metadata job has no fileId"))
	}

	file, err := p.service.GetStored(ctx, payload.FileID)
	if errors.Is(err, ErrNotFound) {
		if err := p.finish(ctx, payload.FileID, metadataOutcome{
			MIMEType: "application/octet-stream",
			Category: "binary",
			Metadata: map[string]any{},
			Status:   "skipped",
			Error:    "file is not active",
		}); err != nil {
			return jobs.Permanent(err)
		}
		return nil
	}
	if err != nil {
		return err
	}

	extension := fileExtension(file.Name)

	if file.SizeBytes == 0 {
		outcome := metadataOutcome{
			MIMEType:  canonicalMIME(nil, extension, payload.MIMETypeHint),
			Extension: extension,
			Metadata:  map[string]any{},
			Status:    "ready",
		}
		outcome.Category = categoryForMIME(outcome.MIMEType)
		return p.finish(ctx, file.ID, outcome)
	}

	_, reader, err := p.service.OpenStored(ctx, file.ID, 0, file.SizeBytes)
	if err != nil {
		return p.retryOrFail(ctx, job, file.ID, extension, err)
	}
	defer reader.Close()

	buffered := bufio.NewReaderSize(reader, sniffBytes)
	prefixSize := sniffBytes
	if file.SizeBytes < sniffBytes {
		prefixSize = int(file.SizeBytes)
	}

	prefix, err := buffered.Peek(prefixSize)
	if err != nil {
		return p.retryOrFail(ctx, job, file.ID, extension, fmt.Errorf("read file signature: %w", err))
	}

	outcome := metadataOutcome{
		MIMEType:  canonicalMIME(prefix, extension, payload.MIMETypeHint),
		Extension: extension,
		Metadata:  map[string]any{},
		Status:    "ready",
	}
	outcome.Category = categoryForMIME(outcome.MIMEType)

	if outcome.Category == "image" {
		config, format, err := image.DecodeConfig(buffered)
		if err != nil {
			outcome.Status = "failed"
			outcome.Error = truncateMetadataError(fmt.Errorf("decode image metadata: %w", err))
			return p.finish(ctx, file.ID, outcome)
		}
		if config.Width <= 0 || config.Height <= 0 {
			outcome.Status = "failed"
			outcome.Error = "image dimensions are invalid"
			return p.finish(ctx, file.ID, outcome)
		}

		width, height := config.Width, config.Height
		outcome.Width = &width
		outcome.Height = &height
		outcome.Metadata["imageFormat"] = format
	}

	return p.finish(ctx, file.ID, outcome)
}

func (p *MetadataProcessor) retryOrFail(ctx context.Context, job jobs.Job, fileID, extension string, cause error) error {
	if job.Attempts < job.MaxAttempts {
		return cause
	}

	outcome := metadataOutcome{
		MIMEType:  "application/octet-stream",
		Extension: extension,
		Category:  "binary",
		Metadata:  map[string]any{},
		Status:    "failed",
		Error:     truncateMetadataError(cause),
	}
	if err := p.finish(ctx, fileID, outcome); err != nil {
		return err
	}
	return nil
}

func (p *MetadataProcessor) finish(ctx context.Context, fileID string, outcome metadataOutcome) error {
	if outcome.Metadata == nil {
		outcome.Metadata = map[string]any{}
	}

	metadata, err := json.Marshal(outcome.Metadata)
	if err != nil {
		return fmt.Errorf("encode file metadata: %w", err)
	}

	return postgres.InTx(ctx, p.service.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE files
			SET mime_type = $2,
			    extension = NULLIF($3, ''),
			    category = $4,
			    width = $5,
			    height = $6,
			    duration_ms = NULL,
			    bitrate_bps = NULL,
			    codec = NULL,
			    metadata = $7::jsonb,
			    metadata_status = $8,
			    metadata_error = NULLIF($9, ''),
			    updated_at = now()
			WHERE node_id = $1::uuid
		`, fileID, outcome.MIMEType, outcome.Extension, outcome.Category,
			outcome.Width, outcome.Height, metadata, outcome.Status, outcome.Error)
		if err != nil {
			return fmt.Errorf("update file metadata: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrNotFound
		}

		if outcome.Status != "ready" || (outcome.Category != "image" && outcome.Category != "video") {
			return nil
		}

		if _, err := tx.Exec(ctx, `
			WITH thumbnail AS (
				INSERT INTO file_thumbnails (file_id, variant, status)
				VALUES ($1::uuid, 'grid', 'pending')
				ON CONFLICT (file_id, variant) DO NOTHING
				RETURNING file_id
			)
			INSERT INTO jobs (type, payload)
			SELECT 'file.thumbnail', jsonb_build_object('fileId', file_id::text)
			FROM thumbnail
		`, fileID); err != nil {
			return fmt.Errorf("enqueue file thumbnail job: %w", err)
		}
		return nil
	})
}

func canonicalMIME(prefix []byte, extension, hint string) string {
	if len(prefix) > 0 {
		detected := normalizeMIME(http.DetectContentType(prefix))
		if detected != "" && detected != "application/octet-stream" {
			return detected
		}
	}

	if extension != "" {
		if value := normalizeMIME(mime.TypeByExtension("." + extension)); value != "" {
			return value
		}
	}

	if value := normalizeMIME(hint); value != "" {
		return value
	}

	return "application/octet-stream"
}

func normalizeMIME(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	mediaType, _, err := mime.ParseMediaType(value)
	if err != nil {
		return ""
	}
	return strings.ToLower(mediaType)
}

func fileExtension(name string) string {
	if strings.HasPrefix(name, ".") && !strings.Contains(strings.TrimPrefix(name, "."), ".") {
		return ""
	}

	extension := strings.ToLower(path.Ext(name))
	return strings.TrimPrefix(extension, ".")
}

func categoryForMIME(value string) string {
	switch {
	case strings.HasPrefix(value, "image/"):
		return "image"
	case strings.HasPrefix(value, "video/"):
		return "video"
	case strings.HasPrefix(value, "audio/"):
		return "audio"
	case strings.HasPrefix(value, "text/"):
		return "text"
	}

	switch value {
	case "application/pdf",
		"application/rtf",
		"application/msword",
		"application/vnd.ms-excel",
		"application/vnd.ms-powerpoint",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		"application/vnd.oasis.opendocument.text",
		"application/vnd.oasis.opendocument.spreadsheet",
		"application/vnd.oasis.opendocument.presentation":
		return "document"

	case "application/zip",
		"application/gzip",
		"application/x-7z-compressed",
		"application/x-rar-compressed",
		"application/x-tar",
		"application/x-bzip2",
		"application/zstd":
		return "archive"

	case "application/octet-stream":
		return "binary"
	}

	if strings.HasPrefix(value, "application/") {
		return "application"
	}
	return "other"
}

func truncateMetadataError(err error) string {
	if err == nil {
		return ""
	}

	value := []rune(strings.TrimSpace(err.Error()))
	if len(value) > 1000 {
		value = value[:1000]
	}
	return string(value)
}
