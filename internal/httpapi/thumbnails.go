package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/collections"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/files"
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
		if file.Category != "image" && file.Category != "video" {
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
}
