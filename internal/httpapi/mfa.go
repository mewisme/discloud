package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	mfadomain "github.com/mewisme/discloud/internal/mfa"
)

type mfaCodeRequest struct {
	Code string `json:"code"`
}

type mfaEnrollmentResponse struct {
	ProvisioningURI string    `json:"provisioningUri"`
	ExpiresAt       time.Time `json:"expiresAt"`
}

type mfaConfirmationResponse struct {
	RecoveryCodes []string `json:"recoveryCodes"`
}

func registerMFARoutes(mux *http.ServeMux, service *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(service, cfg, handler))
	}

	protected("POST /api/v1/me/mfa/totp/enroll", func(w http.ResponseWriter, r *http.Request) {
		principal := currentPrincipal(r.Context())

		enrollment, err := service.EnrollMFA(r.Context(), principal.User.ID, principal.User.Username)
		switch {
		case errors.Is(err, mfadomain.ErrAlreadyEnabled):
			WriteProblem(w, r, http.StatusConflict, "Conflict", "MFA is already enabled")
			return
		case errors.Is(err, auth.ErrMFAUnavailable):
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "MFA service unavailable")
			return
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not start MFA enrollment")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(mfaEnrollmentResponse{
			ProvisioningURI: enrollment.ProvisioningURI,
			ExpiresAt:       enrollment.ExpiresAt,
		})
	})

	protected("POST /api/v1/me/mfa/totp/confirm", func(w http.ResponseWriter, r *http.Request) {
		var input mfaCodeRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		principal := currentPrincipal(r.Context())
		confirmation, err := service.ConfirmMFA(r.Context(), principal.User.ID, input.Code)

		switch {
		case errors.Is(err, mfadomain.ErrEnrollmentNotFound):
			WriteProblem(w, r, http.StatusConflict, "Conflict", "no active MFA enrollment")
			return
		case errors.Is(err, mfadomain.ErrInvalidCode):
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid authentication code")
			return
		case errors.Is(err, mfadomain.ErrAlreadyEnabled):
			WriteProblem(w, r, http.StatusConflict, "Conflict", "MFA is already enabled")
			return
		case errors.Is(err, auth.ErrMFAUnavailable):
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "MFA service unavailable")
			return
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not confirm MFA enrollment")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(mfaConfirmationResponse{
			RecoveryCodes: confirmation.RecoveryCodes,
		})
	})

	protected("POST /api/v1/me/mfa/recovery-codes/regenerate", func(w http.ResponseWriter, r *http.Request) {
		var input mfaCodeRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		principal := currentPrincipal(r.Context())
		confirmation, err := service.RegenerateRecoveryCodes(r.Context(), principal.User.ID, input.Code)

		switch {
		case errors.Is(err, mfadomain.ErrNotEnabled):
			WriteProblem(w, r, http.StatusConflict, "Conflict", "MFA is not enabled")
			return
		case errors.Is(err, mfadomain.ErrInvalidCode):
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid authentication code")
			return
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not regenerate recovery codes")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(mfaConfirmationResponse{
			RecoveryCodes: confirmation.RecoveryCodes,
		})
	})

	protected("DELETE /api/v1/me/mfa/totp", func(w http.ResponseWriter, r *http.Request) {
		var input mfaCodeRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		principal := currentPrincipal(r.Context())
		err := service.DisableMFA(r.Context(), principal.User.ID, principal.SessionID, input.Code)

		switch {
		case errors.Is(err, mfadomain.ErrNotEnabled):
			WriteProblem(w, r, http.StatusConflict, "Conflict", "MFA is not enabled")
			return
		case errors.Is(err, mfadomain.ErrInvalidCode):
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid authentication code")
			return
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not disable MFA")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})

	mux.Handle("DELETE /api/v1/admin/users/{userId}/mfa", requireAdmin(service, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal := currentPrincipal(r.Context())
		targetUserID := r.PathValue("userId")

		err := service.ResetMFA(
			r.Context(),
			targetUserID,
			principal.User.ID,
			RequestID(r.Context()),
			requestIP(r),
		)

		switch {
		case errors.Is(err, mfadomain.ErrUserNotFound):
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "user not found")
			return
		case errors.Is(err, auth.ErrMFAUnavailable):
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "MFA service unavailable")
			return
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not reset MFA")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})))
}
