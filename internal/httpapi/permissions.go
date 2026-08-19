package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
)

type setFolderPermissionRequest struct {
	Level string `json:"level"`
}

type folderPermissionResponse struct {
	UserID    string    `json:"userId"`
	Username  string    `json:"username"`
	Level     string    `json:"level"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func registerPermissionRoutes(mux *http.ServeMux, service *acl.Service, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}

	protected("GET /api/v1/folders/{folderId}/permissions", func(w http.ResponseWriter, r *http.Request) {
		grants, err := service.List(r.Context(), permissionActor(r), r.PathValue("folderId"))
		if writePermissionError(w, r, err) {
			return
		}

		response := make([]folderPermissionResponse, len(grants))
		for i, grant := range grants {
			response[i] = permissionJSON(grant)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Permissions []folderPermissionResponse `json:"permissions"`
		}{response})
	})

	protected("PUT /api/v1/folders/{folderId}/permissions/{userId}", func(w http.ResponseWriter, r *http.Request) {
		var input setFolderPermissionRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		level, err := acl.ParseLevel(input.Level)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "level must be view, edit, or full")
			return
		}

		grant, err := service.Set(
			r.Context(),
			permissionActor(r),
			r.PathValue("folderId"),
			r.PathValue("userId"),
			level,
		)
		if writePermissionError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(permissionJSON(grant))
	})

	protected("DELETE /api/v1/folders/{folderId}/permissions/{userId}", func(w http.ResponseWriter, r *http.Request) {
		err := service.Delete(
			r.Context(),
			permissionActor(r),
			r.PathValue("folderId"),
			r.PathValue("userId"),
		)
		if writePermissionError(w, r, err) {
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
}

func permissionActor(r *http.Request) acl.Actor {
	principal := currentPrincipal(r.Context())
	return acl.Actor{
		UserID: principal.User.ID,
		Admin:  principal.User.Role == "admin",
	}
}

func permissionJSON(grant acl.Grant) folderPermissionResponse {
	return folderPermissionResponse{
		UserID:    grant.UserID,
		Username:  grant.Username,
		Level:     grant.Level.String(),
		CreatedBy: grant.CreatedBy,
		CreatedAt: grant.CreatedAt,
		UpdatedAt: grant.UpdatedAt,
	}
}

func writePermissionError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}

	switch {
	case errors.Is(err, acl.ErrNotFound), errors.Is(err, acl.ErrNotFolder):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "folder not found")
	case errors.Is(err, acl.ErrForbidden):
		WriteProblem(w, r, http.StatusForbidden, "Forbidden", "full folder permission is required")
	case errors.Is(err, acl.ErrInvalidLevel):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid permission level")
	case errors.Is(err, acl.ErrUserNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "user not found")
	case errors.Is(err, acl.ErrOwnerGrant):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "folder owner already has full access")
	case errors.Is(err, acl.ErrGrantNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "folder permission not found")
	default:
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not manage folder permissions")
	}

	return true
}
