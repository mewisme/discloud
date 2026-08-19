package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
)

const accountBodyLimit = 16 << 10

type updateMeRequest struct {
	Username string `json:"username"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type sessionResponse struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
	Current   bool      `json:"current"`
}

func registerMeRoutes(mux *http.ServeMux, service *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(service, cfg, handler))
	}

	protected("GET /api/v1/me", func(w http.ResponseWriter, r *http.Request) {
		writeUser(w, currentPrincipal(r.Context()).User)
	})

	protected("PATCH /api/v1/me", func(w http.ResponseWriter, r *http.Request) {
		var input updateMeRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		user, err := service.UpdateUsername(r.Context(), currentPrincipal(r.Context()).User.ID, input.Username)
		switch {
		case errors.Is(err, auth.ErrInvalidUsername):
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", err.Error())
		case errors.Is(err, auth.ErrUsernameTaken):
			WriteProblem(w, r, http.StatusConflict, "Conflict", "username already exists")
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not update account")
		default:
			writeUser(w, user)
		}
	})

	protected("PUT /api/v1/me/password", func(w http.ResponseWriter, r *http.Request) {
		var input changePasswordRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		principal := currentPrincipal(r.Context())
		err := service.ChangePassword(r.Context(), principal.User.ID, principal.SessionID, input.CurrentPassword, input.NewPassword)

		switch {
		case errors.Is(err, auth.ErrWeakPassword):
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", err.Error())
		case errors.Is(err, auth.ErrCurrentPassword):
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "current password is incorrect")
		case errors.Is(err, auth.ErrPasswordChanged):
			WriteProblem(w, r, http.StatusConflict, "Conflict", "password was changed by another request")
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not update password")
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	})

	protected("GET /api/v1/me/sessions", func(w http.ResponseWriter, r *http.Request) {
		principal := currentPrincipal(r.Context())
		sessions, err := service.ListSessions(r.Context(), principal.User.ID, principal.SessionID)
		if err != nil {
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not list sessions")
			return
		}

		response := make([]sessionResponse, len(sessions))
		for i, session := range sessions {
			response[i] = sessionResponse{
				ID:        session.ID,
				CreatedAt: session.CreatedAt,
				ExpiresAt: session.ExpiresAt,
				Current:   session.Current,
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Sessions []sessionResponse `json:"sessions"`
		}{response})
	})

	protected("DELETE /api/v1/me/sessions/{sessionId}", func(w http.ResponseWriter, r *http.Request) {
		principal := currentPrincipal(r.Context())
		sessionID := r.PathValue("sessionId")

		err := service.RevokeSession(r.Context(), principal.User.ID, sessionID)
		switch {
		case errors.Is(err, auth.ErrSessionNotFound):
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "session not found")
			return
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not revoke session")
			return
		}

		if sessionID == principal.SessionID {
			clearSessionCookie(w, cfg)
		}
		w.WriteHeader(http.StatusNoContent)
	})

	protected("POST /api/v1/me/sessions/revoke-others", func(w http.ResponseWriter, r *http.Request) {
		principal := currentPrincipal(r.Context())
		if err := service.RevokeOtherSessions(r.Context(), principal.User.ID, principal.SessionID); err != nil {
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not revoke sessions")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
