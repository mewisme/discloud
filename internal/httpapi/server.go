package httpapi

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/adminops"
	"github.com/mewisme/discloud/internal/adminusers"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/avatars"
	"github.com/mewisme/discloud/internal/collections"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/files"
	"github.com/mewisme/discloud/internal/folders"
	"github.com/mewisme/discloud/internal/nodes"
	"github.com/mewisme/discloud/internal/observability"
	"github.com/mewisme/discloud/internal/recentactivity"
	"github.com/mewisme/discloud/internal/search"
	"github.com/mewisme/discloud/internal/settings"
	"github.com/mewisme/discloud/internal/setup"
	"github.com/mewisme/discloud/internal/shares"
	"github.com/mewisme/discloud/internal/storageanalyzer"
	"github.com/mewisme/discloud/internal/thumbnails"
	"github.com/mewisme/discloud/internal/uploads"
)

type RouterDependencies struct {
	Ready        func(context.Context) error
	Setup        *setup.Service
	Auth         *auth.Service
	Avatars      *avatars.Service
	AdminUsers   *adminusers.Service
	AdminOps     *adminops.Service
	BotRuntime   BotRuntimeController
	Metrics      *observability.Metrics
	ACL          *acl.Service
	Nodes        *nodes.Service
	Uploads      *uploads.Service
	PartUploader *uploads.PartUploader
	Finalizer    *uploads.Finalizer
	Files        *files.Service
	Thumbnails   *thumbnails.Service
	Folders      *folders.Service
	Collections  *collections.Service
	Shares       *shares.Service
	Search       *search.Service
	Activity     *recentactivity.Service
	Storage      *storageanalyzer.Service
	Settings     *settings.Service
}

func NewRouter(
	deps RouterDependencies,
	httpConfig config.HTTPConfig,
	authConfig config.AuthConfig,
) http.Handler {
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
		registerUserLookupRoute(mux, deps.Auth, authConfig)
	}

	if deps.Avatars != nil && deps.Auth != nil {
		registerAvatarRoutes(mux, deps.Avatars, deps.Auth, authConfig)
	}

	if deps.AdminUsers != nil && deps.Auth != nil {
		registerAdminUserRoutes(mux, deps.AdminUsers, deps.Auth, authConfig)
		registerWorkspaceRoutes(mux, deps.AdminUsers, deps.Auth, authConfig)
	}

	if deps.AdminOps != nil && deps.Auth != nil {
		registerAdminOpsRoutes(mux, deps.AdminOps, deps.Auth, authConfig)
	}

	if deps.BotRuntime != nil && deps.Auth != nil {
		registerAdminBotRoutes(mux, deps.BotRuntime, deps.Auth, authConfig)
		registerAdminBotControlRoutes(mux, deps.BotRuntime, deps.Auth, authConfig)
	}

	if deps.Metrics != nil && deps.Auth != nil {
		mux.Handle("GET /api/v1/admin/metrics", requireAdmin(deps.Auth, authConfig, metricsHandler(deps.Metrics)))
	}

	if deps.Nodes != nil && deps.Auth != nil {
		registerNodeRoutes(mux, deps.Nodes, deps.Auth, authConfig)
		registerFolderBatchRoutes(mux, deps.Nodes, deps.Auth, authConfig)
		registerTrashRoutes(mux, deps.Nodes, deps.Auth, authConfig)
		registerFavoriteRoutes(mux, deps.Nodes, deps.Auth, authConfig)
	}

	if deps.ACL != nil && deps.Auth != nil {
		registerPermissionRoutes(mux, deps.ACL, deps.Auth, authConfig)
	}

	if deps.Uploads != nil && deps.PartUploader != nil && deps.Finalizer != nil && deps.Auth != nil {
		registerUploadRoutes(mux, deps.Uploads, deps.PartUploader, deps.Finalizer, deps.Auth, authConfig)
	}

	if deps.Collections != nil && deps.Auth != nil {
		registerCollectionRoutes(mux, deps.Collections, deps.Auth, authConfig)
		registerCollectionAccessRoutes(mux, deps.Collections, deps.Auth, authConfig)
	}

	if deps.ACL != nil && deps.Collections != nil && deps.Auth != nil {
		registerSharedRoutes(mux, deps.ACL, deps.Collections, deps.Auth, authConfig)
	}

	if deps.Files != nil && deps.Auth != nil {
		registerFileRoutes(mux, deps.Files, deps.Collections, deps.Auth, authConfig)
		registerDesktopDownloadRoutes(mux, deps.Files, deps.Folders, deps.Collections, deps.Auth, authConfig)
	}

	if deps.Thumbnails != nil && deps.Files != nil && deps.Auth != nil {
		registerThumbnailRoutes(mux, deps.Thumbnails, deps.Files, deps.Collections, deps.Auth, authConfig)
	}

	if deps.Folders != nil && deps.Auth != nil {
		registerFolderDownloadRoutes(mux, deps.Folders, deps.Auth, authConfig)
	}

	if deps.Shares != nil && deps.Auth != nil {
		registerShareRoutes(mux, deps.Shares, deps.Auth, authConfig)
		registerActiveShareRoute(mux, deps.Shares, deps.Auth, authConfig)
	}

	if deps.Shares != nil && deps.Files != nil && deps.Folders != nil {
		registerPublicShareRoutes(mux, deps.Shares, deps.Files, deps.Folders)
	}

	if deps.Search != nil && deps.Auth != nil {
		registerSearchRoutes(mux, deps.Search, deps.Auth, authConfig)
	}

	if deps.Activity != nil && deps.Auth != nil {
		registerRecentActivityRoutes(mux, deps.Activity, deps.Auth, authConfig)
	}

	if deps.Storage != nil && deps.Auth != nil {
		registerStorageAnalyzerRoutes(mux, deps.Storage, deps.Auth, authConfig)
	}

	if deps.Settings != nil && deps.Auth != nil {
		registerSettingsRoutes(mux, deps.Settings, deps.Auth, authConfig)
	}

	handler := csrfMiddleware(httpConfig, mux)
	handler = corsMiddleware(httpConfig, handler)
	handler = securityHeadersMiddleware(httpConfig, handler)
	handler = observabilityMiddleware(deps.Metrics, slog.Default(), handler)

	return RequestIDMiddleware(handler)
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
