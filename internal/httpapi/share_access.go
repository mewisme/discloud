package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/mewisme/discloud/internal/shares"
)

func resolvePublicShareRequest(ctx context.Context, r *http.Request, service *shares.Service) (shares.Share, error) {
	publicID := r.PathValue("publicId")
	return service.ResolvePublic(ctx, publicID, publicShareSessionToken(r, publicID))
}

func publicShareSessionToken(r *http.Request, publicID string) string {
	cookie, err := r.Cookie(publicShareCookieName(publicID))
	if err != nil {
		return ""
	}
	return cookie.Value
}

func setPublicShareSessionCookie(w http.ResponseWriter, r *http.Request, publicID string, result shares.UnlockResult) {
	if result.Token == "" {
		return
	}
	maxAge := int(time.Until(result.ExpiresAt).Seconds())
	if maxAge < 1 {
		maxAge = 1
	}
	http.SetCookie(w, &http.Cookie{
		Name: publicShareCookieName(publicID), Value: result.Token, Path: "/",
		Expires: result.ExpiresAt, MaxAge: maxAge, HttpOnly: true, Secure: requestIsHTTPS(r), SameSite: http.SameSiteLaxMode,
	})
}

func publicShareCookieName(publicID string) string {
	hash := sha256.Sum256([]byte(publicID))
	return "discloud_share_" + hex.EncodeToString(hash[:8])
}

func requestIsHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
	return strings.EqualFold(forwarded, "https")
}
