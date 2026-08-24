package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/storageanalyzer"
)

func registerStorageAnalyzerRoutes(mux *http.ServeMux, service *storageanalyzer.Service, authService *auth.Service, cfg config.AuthConfig) {
	mux.Handle("GET /api/v1/storage/analyzer", requireAuth(authService, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal := currentPrincipal(r.Context())
		snapshot, err := service.Analyze(r.Context(), storageanalyzer.Actor{UserID: principal.User.ID, Admin: principal.User.Role == "admin"}, r.URL.Query().Get("ownerId"))
		if writeStorageAnalyzerError(w, r, err) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(snapshot)
	})))
}

func writeStorageAnalyzerError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, storageanalyzer.ErrInvalidQuery):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid storage analyzer query")
	case errors.Is(err, storageanalyzer.ErrForbidden):
		WriteProblem(w, r, http.StatusForbidden, "Forbidden", "storage analyzer access denied")
	default:
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not analyze storage")
	}
	return true
}
