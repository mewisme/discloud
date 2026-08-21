package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mewisme/discloud/internal/config"
)

func TestCORSMiddleware(t *testing.T) {
	cfg := config.HTTPConfig{
		CORS: config.CORSConfig{
			AllowedOrigins: []string{
				"https://app.example.com",
			},
		},
	}

	t.Run("allowed request", func(t *testing.T) {
		req := httptest.NewRequest(
			http.MethodGet,
			"https://api.example.com/api/v1/test",
			nil,
		)
		req.Header.Set("Origin", "https://app.example.com")

		rec := httptest.NewRecorder()

		corsMiddleware(cfg, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})).ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
			t.Fatalf("Access-Control-Allow-Origin = %q", got)
		}
		if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
			t.Fatalf("Access-Control-Allow-Credentials = %q", got)
		}
	})

	t.Run("upload preflight", func(t *testing.T) {
		called := false

		req := httptest.NewRequest(
			http.MethodOptions,
			"https://api.example.com/api/v1/uploads/id/parts/0",
			nil,
		)

		req.Header.Set("Origin", "https://app.example.com")
		req.Header.Set("Access-Control-Request-Method", http.MethodPut)
		req.Header.Set("Access-Control-Request-Headers", "content-type,x-chunk-sha256")

		rec := httptest.NewRecorder()

		corsMiddleware(cfg, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			called = true
			w.WriteHeader(http.StatusNoContent)
		})).ServeHTTP(rec, req)

		if called {
			t.Fatal("preflight reached downstream handler")
		}
		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
			t.Fatalf("Access-Control-Allow-Origin = %q", got)
		}
		if got := rec.Header().Get("Access-Control-Allow-Methods"); got == "" {
			t.Fatal("Access-Control-Allow-Methods is missing")
		}
		if got := rec.Header().Get("Access-Control-Allow-Headers"); got == "" {
			t.Fatal("Access-Control-Allow-Headers is missing")
		}
	})

	t.Run("disallowed preflight", func(t *testing.T) {
		req := httptest.NewRequest(
			http.MethodOptions,
			"https://api.example.com/api/v1/test",
			nil,
		)

		req.Header.Set("Origin", "https://evil.example.com")
		req.Header.Set("Access-Control-Request-Method", http.MethodPost)

		rec := httptest.NewRecorder()

		corsMiddleware(cfg, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})).ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})

	t.Run("disallowed header", func(t *testing.T) {
		req := httptest.NewRequest(
			http.MethodOptions,
			"https://api.example.com/api/v1/test",
			nil,
		)

		req.Header.Set("Origin", "https://app.example.com")
		req.Header.Set("Access-Control-Request-Method", http.MethodPost)
		req.Header.Set("Access-Control-Request-Headers", "x-not-allowed")

		rec := httptest.NewRecorder()

		corsMiddleware(cfg, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})).ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})
}
