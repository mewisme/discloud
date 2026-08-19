package httpapi

import (
	"context"
	"net/http"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/setup"
)

func NewRouter(ready func(context.Context) error, setupService *setup.Service, authService *auth.Service, authConfig config.AuthConfig) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := ready(r.Context()); err != nil {
			WriteProblem(w, r, http.StatusServiceUnavailable, "Service Unavailable", "service is not ready")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	if setupService != nil {
		registerSetupRoutes(mux, setupService)
	}
	if authService != nil {
		registerAuthRoutes(mux, authService, authConfig)
	}

	return RequestIDMiddleware(mux)
}

func NewServer(cfg config.HTTPConfig, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              cfg.ListenAddress,
		Handler:           handler,
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		IdleTimeout:       cfg.IdleTimeout,
		MaxHeaderBytes:    cfg.MaxHeaderBytes,
	}
}
