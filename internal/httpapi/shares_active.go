package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/shares"
)

func registerActiveShareRoute(mux *http.ServeMux, service *shares.Service, authService *auth.Service, cfg config.AuthConfig) {
	mux.Handle("GET /api/v1/shares/active", requireAuth(authService, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resourceType, err := shares.ParseResourceType(strings.TrimSpace(r.URL.Query().Get("resourceType")))
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "resourceType must be file, folder, or collection")
			return
		}

		resourceID := strings.TrimSpace(r.URL.Query().Get("resourceId"))
		if resourceID == "" {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "resourceId is required")
			return
		}

		share, err := service.Active(r.Context(), shareActor(r), shares.CreateInput{
			ResourceType: resourceType,
			ResourceID:   resourceID,
		})
		if writeShareError(w, r, err) {
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(shareJSON(share))
	})))
}
