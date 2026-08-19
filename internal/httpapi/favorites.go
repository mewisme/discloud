package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/nodes"
)

func registerFavoriteRoutes(mux *http.ServeMux, service *nodes.Service, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}

	protected("PUT /api/v1/nodes/{nodeId}/favorite", func(w http.ResponseWriter, r *http.Request) {
		node, err := service.SetFavorite(r.Context(), nodeActor(r), r.PathValue("nodeId"), true)
		if writeNodeError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(nodeJSON(node))
	})

	protected("DELETE /api/v1/nodes/{nodeId}/favorite", func(w http.ResponseWriter, r *http.Request) {
		node, err := service.SetFavorite(r.Context(), nodeActor(r), r.PathValue("nodeId"), false)
		if writeNodeError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(nodeJSON(node))
	})
}
