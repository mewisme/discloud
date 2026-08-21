package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/discordstore"
)

type BotRuntimeController interface {
	BotRuntimeProvider

	ProbeBot(context.Context, string) error
	DrainBot(string) error
	DisableBot(string) error
	EnableBot(string) error
}

type botControlAction func(context.Context, string) error

func registerAdminBotControlRoutes(
	mux *http.ServeMux,
	controller BotRuntimeController,
	authService *auth.Service,
	cfg config.AuthConfig,
) {
	admin := func(pattern string, action botControlAction) {
		mux.Handle(
			pattern,
			requireAdmin(
				authService,
				cfg,
				botRuntimeControlHandler(action),
			),
		)
	}

	admin(
		"POST /api/v1/admin/bots/{botId}/probe",
		controller.ProbeBot,
	)

	admin(
		"POST /api/v1/admin/bots/{botId}/drain",
		func(_ context.Context, userID string) error {
			return controller.DrainBot(userID)
		},
	)

	admin(
		"POST /api/v1/admin/bots/{botId}/disable",
		func(_ context.Context, userID string) error {
			return controller.DisableBot(userID)
		},
	)

	admin(
		"POST /api/v1/admin/bots/{botId}/enable",
		func(_ context.Context, userID string) error {
			return controller.EnableBot(userID)
		},
	)
}

func botRuntimeControlHandler(action botControlAction) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := strings.TrimSpace(r.PathValue("botId"))
		if userID == "" {
			WriteProblem(
				w,
				r,
				http.StatusNotFound,
				"Not Found",
				"Discord bot not found",
			)
			return
		}

		if err := action(r.Context(), userID); err != nil {
			writeBotRuntimeControlError(w, r, err)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
}

func writeBotRuntimeControlError(
	w http.ResponseWriter,
	r *http.Request,
	err error,
) {
	switch {
	case errors.Is(err, discordstore.ErrBotNotFound):
		WriteProblem(
			w,
			r,
			http.StatusNotFound,
			"Not Found",
			"Discord bot not found",
		)

	case errors.Is(err, blobstore.ErrNoUsableBot):
		WriteProblem(
			w,
			r,
			http.StatusConflict,
			"Conflict",
			"Discord bot is temporarily unavailable",
		)

	default:
		var upstream *discordstore.UpstreamError
		if !errors.As(err, &upstream) {
			WriteProblem(
				w,
				r,
				http.StatusInternalServerError,
				"Internal Server Error",
				"bot runtime operation failed",
			)
			return
		}

		switch upstream.Class {
		case discordstore.ErrorRateLimited,
			discordstore.ErrorTimeout,
			discordstore.ErrorUnavailable:
			WriteProblem(
				w,
				r,
				http.StatusServiceUnavailable,
				"Service Unavailable",
				"Discord bot probe is temporarily unavailable",
			)

		default:
			WriteProblem(
				w,
				r,
				http.StatusBadGateway,
				"Bad Gateway",
				"Discord bot probe failed",
			)
		}
	}
}
