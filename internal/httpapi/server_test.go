package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/config"
)

func TestNewServer(t *testing.T) {
	cfg := config.HTTPConfig{
		ListenAddress:     ":9000",
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       time.Minute,
		MaxHeaderBytes:    2 << 20,
	}
	handler := http.NewServeMux()
	server := NewServer(cfg, handler)

	if server.Addr != cfg.ListenAddress {
		t.Fatalf("Addr = %q, want %q", server.Addr, cfg.ListenAddress)
	}
	if server.Handler != handler {
		t.Fatal("Handler was not preserved")
	}
	if server.ReadHeaderTimeout != cfg.ReadHeaderTimeout || server.IdleTimeout != cfg.IdleTimeout || server.MaxHeaderBytes != cfg.MaxHeaderBytes {
		t.Fatal("server configuration was not preserved")
	}
}

func TestHealthz(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	NewRouter(
		RouterDependencies{
			Ready: func(context.Context) error { return nil },
		},
		config.HTTPConfig{},
		config.AuthConfig{},
	).ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
}

func TestReadyz(t *testing.T) {
	tests := []struct {
		name  string
		check func(context.Context) error
		want  int
	}{
		{"ready", func(context.Context) error { return nil }, http.StatusNoContent},
		{"not ready", func(context.Context) error { return errors.New("database unavailable") }, http.StatusServiceUnavailable},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
			rec := httptest.NewRecorder()

			NewRouter(
				RouterDependencies{Ready: tt.check},
				config.HTTPConfig{},
				config.AuthConfig{},
			).ServeHTTP(rec, req)

			if rec.Code != tt.want {
				t.Fatalf("status = %d, want %d", rec.Code, tt.want)
			}
		})
	}
}

func TestSessionCookie(t *testing.T) {
	cfg := config.AuthConfig{
		Cookie: config.CookieConfig{
			Name:     "session",
			Path:     "/",
			Secure:   true,
			SameSite: config.SameSiteStrict,
		},
	}

	rec := httptest.NewRecorder()
	setSessionCookie(rec, cfg, "secret", time.Now().Add(time.Hour))

	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies = %d, want 1", len(cookies))
	}

	cookie := cookies[0]
	if cookie.Value != "secret" || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie = %+v", cookie)
	}
}
