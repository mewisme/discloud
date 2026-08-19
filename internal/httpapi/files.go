package httpapi

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/files"
)

type fileResponse struct {
	ID             string          `json:"id"`
	OwnerUserID    string          `json:"ownerUserId"`
	ParentFolderID string          `json:"parentFolderId"`
	Name           string          `json:"name"`
	Size           int64           `json:"size"`
	ChunkSize      int64           `json:"chunkSize"`
	SHA256         string          `json:"sha256,omitempty"`
	MIMEType       string          `json:"mimeType"`
	Extension      string          `json:"extension,omitempty"`
	Category       string          `json:"category"`
	Width          *int            `json:"width,omitempty"`
	Height         *int            `json:"height,omitempty"`
	DurationMS     *int64          `json:"durationMs,omitempty"`
	BitrateBPS     *int64          `json:"bitrateBps,omitempty"`
	Codec          string          `json:"codec,omitempty"`
	Metadata       json.RawMessage `json:"metadata"`
	MetadataStatus string          `json:"metadataStatus"`
	MetadataError  string          `json:"metadataError,omitempty"`
}

func registerFileRoutes(mux *http.ServeMux, service *files.Service, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}

	protected("GET /api/v1/files/{fileId}", func(w http.ResponseWriter, r *http.Request) {
		file, err := service.Get(r.Context(), fileActor(r), r.PathValue("fileId"))
		if writeFileError(w, r, err) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(fileJSON(file))
	})

	protected("GET /api/v1/files/{fileId}/content", func(w http.ResponseWriter, r *http.Request) {
		serveFile(w, r, service, false)
	})

	protected("GET /api/v1/files/{fileId}/download", func(w http.ResponseWriter, r *http.Request) {
		serveFile(w, r, service, true)
	})
}

func serveFile(w http.ResponseWriter, r *http.Request, service *files.Service, download bool) {
	file, err := service.Get(r.Context(), fileActor(r), r.PathValue("fileId"))
	if writeFileError(w, r, err) {
		return
	}

	byteRange, err := files.ParseRange(r.Header.Get("Range"), file.SizeBytes)
	if errors.Is(err, files.ErrUnsatisfiableRange) {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", file.SizeBytes))
		WriteProblem(w, r, http.StatusRequestedRangeNotSatisfiable, "Range Not Satisfiable", "requested byte range is outside the file")
		return
	}
	if errors.Is(err, files.ErrInvalidRange) {
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid Range header")
		return
	}
	if err != nil {
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not parse file range")
		return
	}

	start, length, status := int64(0), file.SizeBytes, http.StatusOK
	if byteRange != nil {
		start, length, status = byteRange.Start, byteRange.Length(), http.StatusPartialContent
	}

	_, reader, err := service.Open(r.Context(), fileActor(r), file.ID, start, length)
	if writeFileError(w, r, err) {
		return
	}
	defer reader.Close()

	setFileHeaders(w, file, download, length)
	if byteRange != nil {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", byteRange.Start, byteRange.End, file.SizeBytes))
	}

	w.WriteHeader(status)
	if r.Method == http.MethodHead || length == 0 {
		return
	}
	_, _ = io.Copy(w, reader)
}

func setFileHeaders(w http.ResponseWriter, file files.File, download bool, length int64) {
	w.Header().Set("Content-Type", file.MIMEType)
	w.Header().Set("Content-Length", strconv.FormatInt(length, 10))
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	if len(file.SHA256) == 32 {
		w.Header().Set("ETag", `"`+hex.EncodeToString(file.SHA256)+`"`)
	}

	disposition := "attachment"
	if !download && safeInlineMIME(file.MIMEType) {
		disposition = "inline"
	}
	value := mime.FormatMediaType(disposition, map[string]string{"filename": file.Name})
	if value == "" {
		value = disposition
	}
	w.Header().Set("Content-Disposition", value)
}

func safeInlineMIME(value string) bool {
	value = strings.ToLower(strings.TrimSpace(strings.SplitN(value, ";", 2)[0]))
	switch value {
	case "application/pdf", "text/plain", "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif":
		return true
	}
	return strings.HasPrefix(value, "audio/") || strings.HasPrefix(value, "video/")
}

func fileActor(r *http.Request) files.Actor {
	principal := currentPrincipal(r.Context())
	return files.Actor{UserID: principal.User.ID, Admin: principal.User.Role == "admin"}
}

func fileJSON(file files.File) fileResponse {
	response := fileResponse{
		ID: file.ID, OwnerUserID: file.OwnerUserID, ParentFolderID: file.ParentFolderID,
		Name: file.Name, Size: file.SizeBytes, ChunkSize: file.ChunkSizeBytes,
		MIMEType: file.MIMEType, Extension: file.Extension, Category: file.Category,
		Width: file.Width, Height: file.Height, DurationMS: file.DurationMS,
		BitrateBPS: file.BitrateBPS, Codec: file.Codec, Metadata: file.Metadata,
		MetadataStatus: file.MetadataStatus, MetadataError: file.MetadataError,
	}
	if len(file.SHA256) == 32 {
		response.SHA256 = hex.EncodeToString(file.SHA256)
	}
	return response
}

func writeFileError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}

	switch {
	case errors.Is(err, files.ErrNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "file not found")
	case errors.Is(err, files.ErrInvalidSpan):
		WriteProblem(w, r, http.StatusRequestedRangeNotSatisfiable, "Range Not Satisfiable", "invalid file byte range")
	case errors.Is(err, files.ErrStorageInvariant):
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "file storage state is inconsistent")
	default:
		class, retryable := blobstore.Classify(err)
		if class != "unknown" {
			status := http.StatusBadGateway
			if retryable {
				status = http.StatusServiceUnavailable
			}
			WriteProblem(w, r, status, http.StatusText(status), "file storage request failed")
		} else {
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not read file")
		}
	}
	return true
}
