package httpapi

import (
	"errors"
	"log/slog"
	"mime"
	"net/http"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/folders"
)

func registerFolderDownloadRoutes(mux *http.ServeMux, service *folders.Service, authService *auth.Service, cfg config.AuthConfig) {
	mux.Handle("GET /api/v1/folders/{folderId}/download", requireAuth(authService, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		archive, err := service.PrepareArchive(r.Context(), folderActor(r), r.PathValue("folderId"))
		if errors.Is(err, folders.ErrNotFound) {
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "folder not found")
			return
		}
		if err != nil {
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not prepare folder archive")
			return
		}

		disposition := mime.FormatMediaType("attachment", map[string]string{"filename": archive.Filename})
		if disposition == "" {
			disposition = "attachment"
		}

		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", disposition)
		w.Header().Set("X-Content-Type-Options", "nosniff")

		if err := service.WriteZIP(r.Context(), folderActor(r), archive, w); err != nil {
			slog.ErrorContext(r.Context(), "stream folder archive failed", "error", err)
		}
	})))
}

func folderActor(r *http.Request) folders.Actor {
	principal := currentPrincipal(r.Context())
	return folders.Actor{UserID: principal.User.ID, Admin: principal.User.Role == "admin"}
}
