package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/avatars"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/media"
	"github.com/mewisme/discloud/internal/objects"
)

type avatarResponse struct {
	HasAvatar      bool  `json:"hasAvatar"`
	AvatarRevision int64 `json:"avatarRevision"`
}

func registerAvatarRoutes(mux *http.ServeMux, service *avatars.Service, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}

	protected("GET /api/v1/me/avatar", func(w http.ResponseWriter, r *http.Request) {
		rawURL, err := service.ResolveURL(r.Context(), currentPrincipal(r.Context()).User.ID)
		if errors.Is(err, avatars.ErrNotFound) || errors.Is(err, objects.ErrNotFound) {
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "avatar not found")
			return
		}
		if writeObjectStorageError(w, r, err, "could not load avatar") {
			return
		}
		writeObjectRedirect(w, rawURL, "private, max-age=300")
	})

	protected("PUT /api/v1/me/avatar", func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength > media.AvatarMaxBytes {
			WriteProblem(w, r, http.StatusRequestEntityTooLarge, "Content Too Large", "avatar must be 10 MiB or smaller")
			return
		}

		info, err := service.Put(r.Context(), currentPrincipal(r.Context()).User.ID, r.Body)
		switch {
		case errors.Is(err, media.ErrEmptyImage), errors.Is(err, media.ErrInvalidImage):
			WriteProblem(w, r, http.StatusUnsupportedMediaType, "Unsupported Media Type", "avatar must be a supported image")
			return
		case errors.Is(err, media.ErrImageTooLarge), errors.Is(err, objects.ErrTooLarge):
			WriteProblem(w, r, http.StatusRequestEntityTooLarge, "Content Too Large", "avatar exceeds processing limits")
			return
		case errors.Is(err, avatars.ErrNotFound):
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "user not found")
			return
		}
		if writeObjectStorageError(w, r, err, "could not update avatar") {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(avatarResponse{HasAvatar: info.HasAvatar, AvatarRevision: info.Revision})
	})

	protected("DELETE /api/v1/me/avatar", func(w http.ResponseWriter, r *http.Request) {
		if err := service.Delete(r.Context(), currentPrincipal(r.Context()).User.ID); err != nil {
			if writeObjectStorageError(w, r, err, "could not delete avatar") {
				return
			}
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
