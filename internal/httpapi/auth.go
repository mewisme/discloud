package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
)

const authBodyLimit = 16 << 10

type principalKey struct{}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type mfaVerifyRequest struct {
	ChallengeToken string `json:"challengeToken"`
	Code           string `json:"code"`
}

type userResponse struct {
	ID                 string `json:"id"`
	Username           string `json:"username"`
	Role               string `json:"role"`
	MustChangePassword bool   `json:"mustChangePassword"`
}

type mfaRequiredResponse struct {
	MFARequired    bool      `json:"mfaRequired"`
	ChallengeToken string    `json:"challengeToken"`
	ExpiresAt      time.Time `json:"expiresAt"`
}

func registerAuthRoutes(mux *http.ServeMux, service *auth.Service, cfg config.AuthConfig) {
	mux.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		var input loginRequest
		if err := decodeJSON(w, r, authBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		result, err := service.Login(r.Context(), input.Username, input.Password, limitRunes(r.UserAgent(), 512), requestIP(r))
		switch {
		case errors.Is(err, auth.ErrInvalidCredentials):
			WriteProblem(w, r, http.StatusUnauthorized, "Unauthorized", "invalid username or password")
			return
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not authenticate")
			return
		}

		w.Header().Set("Cache-Control", "no-store")

		if result.MFARequired {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(mfaRequiredResponse{
				MFARequired:    true,
				ChallengeToken: result.ChallengeToken,
				ExpiresAt:      result.ChallengeExpiresAt,
			})
			return
		}

		setSessionCookie(w, cfg, result.Token, result.ExpiresAt)
		writeUser(w, result.User)
	})

	mux.HandleFunc("POST /api/v1/auth/mfa/verify", func(w http.ResponseWriter, r *http.Request) {
		var input mfaVerifyRequest
		if err := decodeJSON(w, r, authBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		result, err := service.CompleteMFA(
			r.Context(),
			input.ChallengeToken,
			input.Code,
			limitRunes(r.UserAgent(), 512),
			requestIP(r),
		)

		switch {
		case errors.Is(err, auth.ErrInvalidMFA):
			WriteProblem(w, r, http.StatusUnauthorized, "Unauthorized", "invalid MFA challenge or code")
			return
		case errors.Is(err, auth.ErrMFAUnavailable):
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "MFA service unavailable")
			return
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not complete authentication")
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		setSessionCookie(w, cfg, result.Token, result.ExpiresAt)
		writeUser(w, result.User)
	})

	mux.HandleFunc("POST /api/v1/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if cookie, err := r.Cookie(cfg.Cookie.Name); err == nil {
			if err := service.RevokeToken(r.Context(), cookie.Value); err != nil {
				WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not log out")
				return
			}
		}

		clearSessionCookie(w, cfg)
		w.WriteHeader(http.StatusNoContent)
	})

	mux.Handle("GET /api/v1/auth/me", requireAuth(service, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeUser(w, currentPrincipal(r.Context()).User)
	})))

	registerMeRoutes(mux, service, cfg)
	registerMFARoutes(mux, service, cfg)
}

func requireAuth(service *auth.Service, cfg config.AuthConfig, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(cfg.Cookie.Name)
		if err != nil {
			WriteProblem(w, r, http.StatusUnauthorized, "Unauthorized", "authentication required")
			return
		}

		principal, err := service.Authenticate(r.Context(), cookie.Value)
		switch {
		case errors.Is(err, auth.ErrUnauthenticated):
			WriteProblem(w, r, http.StatusUnauthorized, "Unauthorized", "authentication required")
			return
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not authenticate session")
			return
		}

		ctx := context.WithValue(r.Context(), principalKey{}, principal)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func currentPrincipal(ctx context.Context) *auth.Principal {
	principal, _ := ctx.Value(principalKey{}).(*auth.Principal)
	return principal
}

func writeUser(w http.ResponseWriter, user auth.User) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(userResponse{
		ID:                 user.ID,
		Username:           user.Username,
		Role:               user.Role,
		MustChangePassword: user.MustChangePassword,
	})
}

func setSessionCookie(w http.ResponseWriter, cfg config.AuthConfig, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     cfg.Cookie.Name,
		Value:    token,
		Path:     cfg.Cookie.Path,
		Domain:   cfg.Cookie.Domain,
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   cfg.Cookie.Secure,
		SameSite: sameSite(cfg.Cookie.SameSite),
	})
}

func clearSessionCookie(w http.ResponseWriter, cfg config.AuthConfig) {
	http.SetCookie(w, &http.Cookie{
		Name:     cfg.Cookie.Name,
		Path:     cfg.Cookie.Path,
		Domain:   cfg.Cookie.Domain,
		Expires:  time.Unix(1, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   cfg.Cookie.Secure,
		SameSite: sameSite(cfg.Cookie.SameSite),
	})
}

func sameSite(mode config.SameSiteMode) http.SameSite {
	switch mode {
	case config.SameSiteStrict:
		return http.SameSiteStrictMode
	case config.SameSiteNone:
		return http.SameSiteNoneMode
	default:
		return http.SameSiteLaxMode
	}
}

func requestIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	if net.ParseIP(r.RemoteAddr) != nil {
		return r.RemoteAddr
	}
	return ""
}

func limitRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}
