package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/recentactivity"
)

func registerRecentActivityRoutes(mux *http.ServeMux, service *recentactivity.Service, authService *auth.Service, cfg config.AuthConfig) {
	mux.Handle("GET /api/v1/activity", requireAuth(authService, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal := currentPrincipal(r.Context())
		query, err := recentActivityQuery(r)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid recent activity query")
			return
		}
		page, err := service.List(r.Context(), recentactivity.Actor{UserID: principal.User.ID, Admin: principal.User.Role == "admin"}, query)
		if writeRecentActivityError(w, r, err) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(page)
	})))

	mux.Handle("POST /api/v1/activity/sync", requireAuth(authService, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input recentactivity.SyncInput
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}
		principal := currentPrincipal(r.Context())
		if writeRecentActivityError(w, r, service.RecordSync(r.Context(), recentactivity.Actor{UserID: principal.User.ID, Admin: principal.User.Role == "admin"}, input)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})))
}

func recentActivityQuery(r *http.Request) (recentactivity.Query, error) {
	values := r.URL.Query()
	query := recentactivity.Query{OwnerID: strings.TrimSpace(values.Get("ownerId"))}
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil {
			return query, err
		}
		query.Limit = value
	}
	beforeAt, beforeID := strings.TrimSpace(values.Get("beforeAt")), strings.TrimSpace(values.Get("beforeId"))
	if (beforeAt == "") != (beforeID == "") {
		return query, recentactivity.ErrInvalidQuery
	}
	if beforeAt != "" {
		value, err := time.Parse(time.RFC3339Nano, beforeAt)
		if err != nil {
			return query, err
		}
		query.BeforeAt, query.BeforeID = &value, beforeID
	}
	return query, nil
}

func writeRecentActivityError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, recentactivity.ErrInvalidQuery):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid recent activity query")
	case errors.Is(err, recentactivity.ErrForbidden):
		WriteProblem(w, r, http.StatusForbidden, "Forbidden", "recent activity access denied")
	default:
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not load recent activity")
	}
	return true
}
