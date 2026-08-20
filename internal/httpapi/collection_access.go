package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/collections"
	"github.com/mewisme/discloud/internal/config"
)

type setCollectionAccessRequest struct {
	Level string `json:"level"`
}

type collectionAccessResponse struct {
	UserID    string    `json:"userId"`
	Username  string    `json:"username"`
	Name      string    `json:"name"`
	Level     string    `json:"level"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func registerCollectionAccessRoutes(mux *http.ServeMux, service *collections.Service, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}

	protected("GET /api/v1/collections/{collectionId}/access", func(w http.ResponseWriter, r *http.Request) {
		grants, err := service.ListGrants(r.Context(), collectionActor(r), r.PathValue("collectionId"))
		if writeCollectionError(w, r, err) {
			return
		}

		response := make([]collectionAccessResponse, len(grants))
		for i, grant := range grants {
			response[i] = collectionAccessJSON(grant)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Access []collectionAccessResponse `json:"access"`
		}{response})
	})

	protected("PUT /api/v1/collections/{collectionId}/access/{userId}", func(w http.ResponseWriter, r *http.Request) {
		var input setCollectionAccessRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		level, err := collections.ParseLevel(input.Level)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "level must be view, edit, or full")
			return
		}

		grant, err := service.SetGrant(
			r.Context(),
			collectionActor(r),
			r.PathValue("collectionId"),
			r.PathValue("userId"),
			level,
		)
		if writeCollectionError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(collectionAccessJSON(grant))
	})

	protected("DELETE /api/v1/collections/{collectionId}/access/{userId}", func(w http.ResponseWriter, r *http.Request) {
		err := service.DeleteGrant(
			r.Context(),
			collectionActor(r),
			r.PathValue("collectionId"),
			r.PathValue("userId"),
		)
		if writeCollectionError(w, r, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func collectionAccessJSON(grant collections.Grant) collectionAccessResponse {
	return collectionAccessResponse{
		UserID: grant.UserID, Username: grant.Username, Name: grant.Name, Level: grant.Level.String(),
		CreatedBy: grant.CreatedBy, CreatedAt: grant.CreatedAt, UpdatedAt: grant.UpdatedAt,
	}
}
