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
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/collections"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/files"
)

type fileVersionResponse struct {
	ID                    string          `json:"id"`
	FileID                string          `json:"fileId"`
	Revision              int64           `json:"revision"`
	Name                  string          `json:"name"`
	Size                  int64           `json:"size"`
	ChunkSize             int64           `json:"chunkSize"`
	SHA256                string          `json:"sha256,omitempty"`
	MIMEType              string          `json:"mimeType"`
	Extension             string          `json:"extension,omitempty"`
	Category              string          `json:"category"`
	Width                 *int            `json:"width,omitempty"`
	Height                *int            `json:"height,omitempty"`
	DurationMS            *int64          `json:"durationMs,omitempty"`
	BitrateBPS            *int64          `json:"bitrateBps,omitempty"`
	Codec                 string          `json:"codec,omitempty"`
	Metadata              json.RawMessage `json:"metadata"`
	MetadataStatus        string          `json:"metadataStatus"`
	MetadataError         string          `json:"metadataError,omitempty"`
	CreatedBy             string          `json:"createdBy"`
	RestoredFromVersionID string          `json:"restoredFromVersionId,omitempty"`
	CreatedAt             time.Time       `json:"createdAt"`
	IsCurrent             bool            `json:"isCurrent"`
}
type fileVersionListResponse struct {
	Versions []fileVersionResponse `json:"versions"`
}

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

func registerFileRoutes(mux *http.ServeMux, service *files.Service, collectionService *collections.Service, authService *auth.Service, cfg config.AuthConfig) {
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
		serveFile(w, r, service, collectionService, false)
	})

	protected("GET /api/v1/files/{fileId}/download", func(w http.ResponseWriter, r *http.Request) {
		serveFile(w, r, service, collectionService, true)
	})

	protected("GET /api/v1/files/{fileId}/versions", func(w http.ResponseWriter, r *http.Request) {
		versions, err := service.ListVersions(r.Context(), fileActor(r), r.PathValue("fileId"))
		if writeFileError(w, r, err) {
			return
		}
		response := fileVersionListResponse{Versions: make([]fileVersionResponse, len(versions))}
		for i, version := range versions {
			response.Versions[i] = fileVersionJSON(version)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	})

	protected("GET /api/v1/files/{fileId}/versions/{versionId}/download", func(w http.ResponseWriter, r *http.Request) { serveFileVersion(w, r, service) })

	protected("POST /api/v1/files/{fileId}/versions/{versionId}/restore", func(w http.ResponseWriter, r *http.Request) {
		version, err := service.RestoreVersion(r.Context(), fileActor(r), r.PathValue("fileId"), r.PathValue("versionId"))
		if writeFileError(w, r, err) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(fileVersionJSON(version))
	})
}

func serveFile(w http.ResponseWriter, r *http.Request, service *files.Service, collectionService *collections.Service, download bool) {
	fileID := r.PathValue("fileId")
	collectionID := strings.TrimSpace(r.URL.Query().Get("collectionId"))

	file, err := getFileForRequest(r, service, collectionService, fileID, collectionID)
	if writeFileContextError(w, r, err) {
		return
	}

	setFileCacheHeaders(w, download)
	setFileValidatorHeaders(w, file)

	if !download && fileNotModified(r, file) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	byteRange, err := requestedFileRange(r, file)
	if errors.Is(err, files.ErrUnsatisfiableRange) {
		w.Header().Set("Accept-Ranges", "bytes")
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

	setFileHeaders(w, file, download, length)
	if byteRange != nil {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", byteRange.Start, byteRange.End, file.SizeBytes))
	}

	if r.Method == http.MethodHead || length == 0 {
		w.WriteHeader(status)
		return
	}

	_, reader, err := openFileForRequest(r, service, collectionService, fileID, collectionID, start, length)
	if writeFileContextError(w, r, err) {
		return
	}
	defer reader.Close()

	w.WriteHeader(status)
	_, _ = io.Copy(w, reader)
}

func getFileForRequest(r *http.Request, service *files.Service, collectionService *collections.Service, fileID, collectionID string) (files.File, error) {
	if collectionID == "" {
		return service.Get(r.Context(), fileActor(r), fileID)
	}
	if collectionService == nil {
		return files.File{}, collections.ErrNotFound
	}
	if err := collectionService.CanViewItem(r.Context(), collectionActor(r), collectionID, fileID); err != nil {
		return files.File{}, err
	}
	return service.GetStored(r.Context(), fileID)
}

func openFileForRequest(r *http.Request, service *files.Service, collectionService *collections.Service, fileID, collectionID string, start, length int64) (files.File, io.ReadCloser, error) {
	if collectionID == "" {
		return service.Open(r.Context(), fileActor(r), fileID, start, length)
	}
	if collectionService == nil {
		return files.File{}, nil, collections.ErrNotFound
	}
	if err := collectionService.CanViewItem(r.Context(), collectionActor(r), collectionID, fileID); err != nil {
		return files.File{}, nil, err
	}
	return service.OpenStored(r.Context(), fileID, start, length)
}

func requestedFileRange(r *http.Request, file files.File) (*files.ByteRange, error) {
	value := r.Header.Get("Range")
	if value != "" && !ifRangeMatches(r.Header.Get("If-Range"), file) {
		value = ""
	}
	return files.ParseRange(value, file.SizeBytes)
}

func fileNotModified(r *http.Request, file files.File) bool {
	if value := strings.TrimSpace(r.Header.Get("If-None-Match")); value != "" {
		return ifNoneMatchMatches(value, fileETag(file))
	}

	value := strings.TrimSpace(r.Header.Get("If-Modified-Since"))
	if value == "" || file.UpdatedAt.IsZero() {
		return false
	}

	validator, err := http.ParseTime(value)
	if err != nil {
		return false
	}
	return !file.UpdatedAt.UTC().Truncate(time.Second).After(validator.UTC())
}

func ifNoneMatchMatches(value, etag string) bool {
	if value == "*" {
		return true
	}
	if etag == "" {
		return false
	}

	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		item = strings.TrimPrefix(item, "W/")
		if item == etag {
			return true
		}
	}
	return false
}

func ifRangeMatches(value string, file files.File) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return true
	}
	if strings.HasPrefix(value, "W/") {
		return false
	}
	if strings.HasPrefix(value, "\"") {
		etag := fileETag(file)
		return etag != "" && value == etag
	}

	validator, err := http.ParseTime(value)
	if err != nil || file.UpdatedAt.IsZero() {
		return false
	}
	return !file.UpdatedAt.UTC().Truncate(time.Second).After(validator.UTC())
}

func setFileHeaders(w http.ResponseWriter, file files.File, download bool, length int64) {
	w.Header().Set("Content-Type", file.MIMEType)
	w.Header().Set("Content-Length", strconv.FormatInt(length, 10))
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	setFileCacheHeaders(w, download)
	setFileValidatorHeaders(w, file)

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

func setFileCacheHeaders(w http.ResponseWriter, download bool) {
	if download {
		w.Header().Set("Cache-Control", "no-store, no-transform")
		return
	}
	w.Header().Set("Cache-Control", "private, no-cache, no-transform")
}

func setFileValidatorHeaders(w http.ResponseWriter, file files.File) {
	if etag := fileETag(file); etag != "" {
		w.Header().Set("ETag", etag)
	}
	if !file.UpdatedAt.IsZero() {
		w.Header().Set("Last-Modified", file.UpdatedAt.UTC().Format(http.TimeFormat))
	}
}

func fileETag(file files.File) string {
	if len(file.SHA256) != 32 {
		return ""
	}
	return `"` + hex.EncodeToString(file.SHA256) + `"`
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

func fileVersionJSON(version files.Version) fileVersionResponse {
	response := fileVersionResponse{ID: version.ID, FileID: version.FileID, Revision: version.Revision, Name: version.Name, Size: version.SizeBytes, ChunkSize: version.ChunkSizeBytes, MIMEType: version.MIMEType, Extension: version.Extension, Category: version.Category, Width: version.Width, Height: version.Height, DurationMS: version.DurationMS, BitrateBPS: version.BitrateBPS, Codec: version.Codec, Metadata: version.Metadata, MetadataStatus: version.MetadataStatus, MetadataError: version.MetadataError, CreatedBy: version.CreatedBy, RestoredFromVersionID: version.RestoredFromVersionID, CreatedAt: version.CreatedAt, IsCurrent: version.IsCurrent}
	if len(version.SHA256) == 32 {
		response.SHA256 = hex.EncodeToString(version.SHA256)
	}
	return response
}

func serveFileVersion(w http.ResponseWriter, r *http.Request, service *files.Service) {
	version, err := service.GetVersion(r.Context(), fileActor(r), r.PathValue("fileId"), r.PathValue("versionId"))
	if writeFileError(w, r, err) {
		return
	}
	projected := version.File()
	byteRange, err := requestedFileRange(r, projected)
	if errors.Is(err, files.ErrUnsatisfiableRange) {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", projected.SizeBytes))
		WriteProblem(w, r, http.StatusRequestedRangeNotSatisfiable, "Range Not Satisfiable", "requested byte range is outside the file")
		return
	}
	if err != nil {
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid Range header")
		return
	}
	start, length, status := int64(0), projected.SizeBytes, http.StatusOK
	if byteRange != nil {
		start, length, status = byteRange.Start, byteRange.Length(), http.StatusPartialContent
	}
	setFileHeaders(w, projected, true, length)
	if byteRange != nil {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", byteRange.Start, byteRange.End, projected.SizeBytes))
	}
	if r.Method == http.MethodHead || length == 0 {
		w.WriteHeader(status)
		return
	}
	_, reader, err := service.OpenVersion(r.Context(), fileActor(r), r.PathValue("fileId"), r.PathValue("versionId"), start, length)
	if writeFileError(w, r, err) {
		return
	}
	defer reader.Close()
	w.WriteHeader(status)
	_, _ = io.Copy(w, reader)
}

func writeFileContextError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case errors.Is(err, collections.ErrNotFound),
		errors.Is(err, collections.ErrForbidden),
		errors.Is(err, collections.ErrFileNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "file not found")
		return true
	default:
		return writeFileError(w, r, err)
	}
}

func writeFileError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}

	switch {
	case errors.Is(err, files.ErrNotFound), errors.Is(err, files.ErrVersionNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "file not found")
	case errors.Is(err, files.ErrForbidden):
		WriteProblem(w, r, http.StatusForbidden, "Forbidden", "file write access forbidden")
	case errors.Is(err, files.ErrVersionQuotaExceeded):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "restoring this version exceeds storage quota")
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
