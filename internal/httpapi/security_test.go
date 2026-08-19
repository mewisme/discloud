package httpapi

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/mewisme/discloud/internal/config"
)

func TestSecurityHeaders(t *testing.T) {
	baseURL, err := url.Parse("https://cloud.example.com")
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}

	handler := securityHeadersMiddleware(
		config.HTTPConfig{PublicBaseURL: baseURL},
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}),
	)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	headers := rec.Header()
	if headers.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}
	if headers.Get("X-Frame-Options") != "DENY" {
		t.Fatal("missing frame protection")
	}
	if headers.Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("missing referrer policy")
	}
	if headers.Get("Permissions-Policy") == "" {
		t.Fatal("missing permissions policy")
	}
	if headers.Get("Strict-Transport-Security") == "" {
		t.Fatal("missing HSTS")
	}
}

func TestSecurityHeadersDoNotSetHSTSForHTTP(t *testing.T) {
	baseURL, err := url.Parse("http://localhost:8080")
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}

	handler := securityHeadersMiddleware(
		config.HTTPConfig{PublicBaseURL: baseURL},
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}),
	)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Header().Get("Strict-Transport-Security") != "" {
		t.Fatal("HSTS was set for HTTP deployment")
	}
}
