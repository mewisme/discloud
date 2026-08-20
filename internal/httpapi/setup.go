package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/setup"
)

const setupBodyLimit = 16 << 10

type setupRequest struct {
	Name     string `json:"name"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func registerSetupRoutes(mux *http.ServeMux, service *setup.Service) {
	mux.HandleFunc("GET /api/v1/setup/status", func(w http.ResponseWriter, r *http.Request) {
		required, err := service.Required(r.Context())
		if err != nil {
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not check setup status")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			SetupRequired bool `json:"setupRequired"`
		}{required})
	})

	mux.HandleFunc("POST /api/v1/setup", func(w http.ResponseWriter, r *http.Request) {
		var input setupRequest
		if err := decodeJSON(w, r, setupBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		userID, err := service.Complete(r.Context(), input.Name, input.Username, input.Password)
		switch {
		case errors.Is(err, auth.ErrInvalidName), errors.Is(err, auth.ErrInvalidUsername), errors.Is(err, auth.ErrWeakPassword):
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", err.Error())
			return
		case errors.Is(err, setup.ErrAlreadySetup):
			WriteProblem(w, r, http.StatusConflict, "Conflict", "setup has already been completed")
			return
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not complete setup")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(struct {
			UserID string `json:"userId"`
		}{userID})
	})
}
