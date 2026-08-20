package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
)

type userLookupResponse struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
}

func registerUserLookupRoute(mux *http.ServeMux, service *auth.Service, cfg config.AuthConfig) {
	mux.Handle("GET /api/v1/users/lookup", requireAuth(service, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		username := strings.TrimSpace(r.URL.Query().Get("username"))
		if username == "" {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "username is required")
			return
		}

		user, err := service.LookupActiveUser(r.Context(), username)
		switch {
		case errors.Is(err, auth.ErrUserLookupNotFound):
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "user not found")
			return
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not look up user")
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(userLookupResponse{ID: user.ID, Username: user.Username, Name: user.Name})
	})))
}
