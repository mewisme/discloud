package httpapi

import (
	"net/http"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
)

func requireAdmin(service *auth.Service, cfg config.AuthConfig, next http.Handler) http.Handler {
	return requireAuth(service, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if currentPrincipal(r.Context()).User.Role != "admin" {
			WriteProblem(w, r, http.StatusForbidden, "Forbidden", "administrator access required")
			return
		}
		next.ServeHTTP(w, r)
	}))
}
