package httpapi

import (
	"net/http"
	"strings"

	"github.com/mewisme/discloud/internal/config"
)

const (
	corsAllowedMethods = "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"
	corsAllowedHeaders = "Accept, Content-Type, If-Match, If-None-Match, Range, X-Chunk-SHA256"
	corsExposedHeaders = "Accept-Ranges, Content-Disposition, Content-Length, Content-Range, ETag, X-Request-ID"
	corsMaxAge         = "600"
)

var allowedCORSMethods = map[string]struct{}{
	http.MethodGet:     {},
	http.MethodHead:    {},
	http.MethodPost:    {},
	http.MethodPut:     {},
	http.MethodPatch:   {},
	http.MethodDelete:  {},
	http.MethodOptions: {},
}

var allowedCORSHeaders = map[string]struct{}{
	"accept":         {},
	"content-type":   {},
	"if-match":       {},
	"if-none-match":  {},
	"range":          {},
	"x-chunk-sha256": {},
}

func corsMiddleware(cfg config.HTTPConfig, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}

		normalizedOrigin, validOrigin := parseOrigin(origin)
		allowed := validOrigin && corsOriginAllowed(cfg, normalizedOrigin)

		if isCORSPreflight(r) {
			if !allowed {
				WriteProblem(w, r, http.StatusForbidden, "Forbidden", "CORS origin is not allowed")
				return
			}

			method := strings.ToUpper(strings.TrimSpace(r.Header.Get("Access-Control-Request-Method")))
			if _, ok := allowedCORSMethods[method]; !ok {
				WriteProblem(w, r, http.StatusForbidden, "Forbidden", "CORS method is not allowed")
				return
			}

			if !corsRequestHeadersAllowed(r.Header.Get("Access-Control-Request-Headers")) {
				WriteProblem(w, r, http.StatusForbidden, "Forbidden", "CORS request headers are not allowed")
				return
			}

			setCORSHeaders(w.Header(), normalizedOrigin)
			w.Header().Add("Vary", "Access-Control-Request-Method")
			w.Header().Add("Vary", "Access-Control-Request-Headers")
			w.Header().Set("Access-Control-Allow-Methods", corsAllowedMethods)
			w.Header().Set("Access-Control-Allow-Headers", corsAllowedHeaders)
			w.Header().Set("Access-Control-Max-Age", corsMaxAge)
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if allowed {
			setCORSHeaders(w.Header(), normalizedOrigin)
		}

		next.ServeHTTP(w, r)
	})
}

func setCORSHeaders(header http.Header, origin string) {
	header.Add("Vary", "Origin")
	header.Set("Access-Control-Allow-Origin", origin)
	header.Set("Access-Control-Allow-Credentials", "true")
	header.Set("Access-Control-Expose-Headers", corsExposedHeaders)
}

func isCORSPreflight(r *http.Request) bool {
	return r.Method == http.MethodOptions &&
		strings.TrimSpace(r.Header.Get("Origin")) != "" &&
		strings.TrimSpace(r.Header.Get("Access-Control-Request-Method")) != ""
}

func corsOriginAllowed(cfg config.HTTPConfig, rawOrigin string) bool {
	origin, ok := parseOrigin(rawOrigin)
	if !ok {
		return false
	}

	for _, allowed := range cfg.CORS.AllowedOrigins {
		candidate, ok := parseOrigin(allowed)
		if ok && candidate == origin {
			return true
		}
	}

	return false
}

func corsRequestHeadersAllowed(value string) bool {
	if strings.TrimSpace(value) == "" {
		return true
	}

	for _, header := range strings.Split(value, ",") {
		name := strings.ToLower(strings.TrimSpace(header))
		if name == "" {
			continue
		}

		if _, ok := allowedCORSHeaders[name]; !ok {
			return false
		}
	}

	return true
}
