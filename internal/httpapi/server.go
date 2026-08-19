package httpapi

import (
	"context"
	"net/http"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/adminusers"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/nodes"
	"github.com/mewisme/discloud/internal/setup"
	"github.com/mewisme/discloud/internal/uploads"
)

type RouterDependencies struct {
	Ready        func(context.Context) error
	Setup        *setup.Service
	Auth         *auth.Service
	AdminUsers   *adminusers.Service
	ACL          *acl.Service
	Nodes        *nodes.Service
	Uploads      *uploads.Service
	PartUploader *uploads.PartUploader
	Finalizer    *uploads.Finalizer
}

func NewRouter(deps RouterDependencies, httpConfig config.HTTPConfig, authConfig config.AuthConfig) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if deps.Ready == nil {
			WriteProblem(w, r, http.StatusServiceUnavailable, "Service Unavailable", "service is not ready")
			return
		}
		if err := deps.Ready(r.Context()); err != nil {
			WriteProblem(w, r, http.StatusServiceUnavailable, "Service Unavailable", "service is not ready")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	if deps.Setup != nil {
		registerSetupRoutes(mux, deps.Setup)
	}
	if deps.Auth != nil {
		registerAuthRoutes(mux, deps.Auth, authConfig)
	}
	if deps.AdminUsers != nil && deps.Auth != nil {
		registerAdminUserRoutes(mux, deps.AdminUsers, deps.Auth, authConfig)
	}
	if deps.Nodes != nil && deps.Auth != nil {
		registerNodeRoutes(mux, deps.Nodes, deps.Auth, authConfig)
	}
	if deps.ACL != nil && deps.Auth != nil {
		registerPermissionRoutes(mux, deps.ACL, deps.Auth, authConfig)
	}
	if deps.Uploads != nil && deps.PartUploader != nil && deps.Finalizer != nil && deps.Auth != nil {
		registerUploadRoutes(mux, deps.Uploads, deps.PartUploader, deps.Finalizer, deps.Auth, authConfig)
	}

	return RequestIDMiddleware(csrfMiddleware(httpConfig, mux))
}

func NewServer(cfg config.HTTPConfig, handler http.Handler) *http.Server {
	return &http.Server{
		Addr: cfg.ListenAddress, Handler: handler, ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		IdleTimeout: cfg.IdleTimeout, MaxHeaderBytes: cfg.MaxHeaderBytes,
	}
}
