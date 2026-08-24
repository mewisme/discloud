package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/collections"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/files"
	"github.com/mewisme/discloud/internal/media"
	"github.com/mewisme/discloud/internal/objects"
	"github.com/mewisme/discloud/internal/thumbnails"
)

func registerThumbnailRoutes(mux *http.ServeMux, service *thumbnails.Service, fileService *files.Service, collectionService *collections.Service, authService *auth.Service, cfg config.AuthConfig) {
	mux.Handle("GET /api/v1/files/{fileId}/thumbnail", requireAuth(authService, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fileID := r.PathValue("fileId")
		collectionID := strings.TrimSpace(r.URL.Query().Get("collectionId"))

		file, err := getFileForRequest(r, fileService, collectionService, fileID, collectionID)
		if writeFileContextError(w, r, err) {
			return
		}
		if file.Category != "image" && file.Category != "video" && file.Category != "audio" {
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "thumbnail not available")
			return
		}

		rawURL, err := service.ResolveURL(r.Context(), file.ID)
		if errors.Is(err, thumbnails.ErrNotFound) || errors.Is(err, thumbnails.ErrNotReady) || errors.Is(err, objects.ErrNotFound) {
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "thumbnail not available")
			return
		}
		if writeObjectStorageError(w, r, err, "could not load thumbnail") {
			return
		}
		writeObjectRedirect(w, rawURL, "private, max-age=300")
	})))

	mux.Handle("PUT /api/v1/files/{fileId}/thumbnail", requireAuth(authService, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		file, err := fileService.GetEditable(r.Context(), fileActor(r), r.PathValue("fileId"))
		if errors.Is(err, files.ErrForbidden) {
			WriteProblem(w, r, http.StatusForbidden, "Forbidden", "write access to this file is required")
			return
		}
		if writeFileContextError(w, r, err) {
			return
		}
		if file.MetadataStatus != "ready" {
			WriteProblem(w, r, http.StatusConflict, "Conflict", "file metadata is not ready")
			return
		}
		if file.Category != "image" && file.Category != "video" && file.Category != "audio" {
			WriteProblem(w, r, http.StatusUnsupportedMediaType, "Unsupported Media Type", "thumbnail is only supported for image, video, and audio files")
			return
		}
		if r.ContentLength > media.ClientThumbnailMaxBytes {
			WriteProblem(w, r, http.StatusRequestEntityTooLarge, "Content Too Large", "thumbnail must be 8 MiB or smaller")
			return
		}

		processed, err := service.UploadFromClient(r.Context(), file.ID, r.Body)
		switch {
		case errors.Is(err, thumbnails.ErrNotPending):
			WriteProblem(w, r, http.StatusConflict, "Conflict", "thumbnail is not pending")
			return
		case errors.Is(err, media.ErrEmptyImage), errors.Is(err, media.ErrInvalidImage):
			WriteProblem(w, r, http.StatusUnsupportedMediaType, "Unsupported Media Type", "thumbnail must be a supported image")
			return
		case errors.Is(err, media.ErrImageTooLarge), errors.Is(err, objects.ErrTooLarge):
			WriteProblem(w, r, http.StatusRequestEntityTooLarge, "Content Too Large", "thumbnail exceeds processing limits")
			return
		}
		if writeObjectStorageError(w, r, err, "could not store thumbnail") {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(thumbnailUploadResponse{
			ThumbnailStatus: "ready",
			Width:           processed.Width,
			Height:          processed.Height,
		})
	})))
}

type thumbnailUploadResponse struct {
	ThumbnailStatus string `json:"thumbnailStatus"`
	Width           int    `json:"width"`
	Height          int    `json:"height"`
}
