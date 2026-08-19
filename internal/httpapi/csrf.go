package httpapi

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/mewisme/discloud/internal/config"
)

func csrfMiddleware(cfg config.HTTPConfig, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if csrfSafeMethod(r.Method) || validRequestOrigin(r, cfg) {
			next.ServeHTTP(w, r)
			return
		}

		WriteProblem(w, r, http.StatusForbidden, "Forbidden", "cross-origin request blocked")
	})
}

func validRequestOrigin(r *http.Request, cfg config.HTTPConfig) bool {
	if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" {
		return sameOrigin(r, cfg, origin)
	}
	if referer := strings.TrimSpace(r.Header.Get("Referer")); referer != "" {
		return sameOrigin(r, cfg, referer)
	}
	return !strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site")
}

func sameOrigin(r *http.Request, cfg config.HTTPConfig, raw string) bool {
	got, ok := parseOrigin(raw)
	if !ok {
		return false
	}

	if cfg.PublicBaseURL != nil {
		want, ok := parseOrigin(cfg.PublicBaseURL.String())
		return ok && strings.EqualFold(got, want)
	}

	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return strings.EqualFold(got, scheme+"://"+r.Host)
}

func parseOrigin(raw string) (string, bool) {
	if strings.EqualFold(raw, "null") {
		return "", false
	}

	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" || u.User != nil {
		return "", false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", false
	}

	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host), true
}

func csrfSafeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodTrace:
		return true
	default:
		return false
	}
}
