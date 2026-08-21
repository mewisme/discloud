package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/discordstore"
)

type BotRuntimeController interface {
	BotRuntimeProvider
	ProbeBot(context.Context, string) error
	ProbeConfiguredBot(context.Context, int) error
	DrainBot(string) error
	DisableBot(string) error
	EnableBot(string) error
}

type botControlAction func(context.Context, string) error

type configuredBotControlAction func(context.Context, int) error

func registerAdminBotControlRoutes(
	mux *http.ServeMux,
	controller BotRuntimeController,
	authService *auth.Service,
	cfg config.AuthConfig,
) {
	admin := func(pattern string, handler http.Handler) {
		mux.Handle(pattern, requireAdmin(authService, cfg, handler))
	}

	admin("POST /api/v1/admin/bots/{botId}/probe", botRuntimeControlHandler(controller.ProbeBot))
	admin("POST /api/v1/admin/bots/config/{configIndex}/probe", configuredBotRuntimeControlHandler(controller.ProbeConfiguredBot))
	admin("POST /api/v1/admin/bots/{botId}/drain", botRuntimeControlHandler(func(_ context.Context, userID string) error {
		return controller.DrainBot(userID)
	}))
	admin("POST /api/v1/admin/bots/{botId}/disable", botRuntimeControlHandler(func(_ context.Context, userID string) error {
		return controller.DisableBot(userID)
	}))
	admin("POST /api/v1/admin/bots/{botId}/enable", botRuntimeControlHandler(func(_ context.Context, userID string) error {
		return controller.EnableBot(userID)
	}))
}

func botRuntimeControlHandler(action botControlAction) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := strings.TrimSpace(r.PathValue("botId"))
		if userID == "" {
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "Discord bot not found")
			return
		}

		if err := action(r.Context(), userID); err != nil {
			writeBotRuntimeControlError(w, r, err)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
}

func configuredBotRuntimeControlHandler(action configuredBotControlAction) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		configIndex, err := strconv.Atoi(strings.TrimSpace(r.PathValue("configIndex")))
		if err != nil || configIndex < 0 {
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "configured Discord bot not found")
			return
		}

		if err := action(r.Context(), configIndex); err != nil {
			writeBotRuntimeControlError(w, r, err)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
}

func writeBotRuntimeControlError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, discordstore.ErrBotNotFound), errors.Is(err, discordstore.ErrConfiguredBotNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "Discord bot not found")
	case errors.Is(err, discordstore.ErrDuplicateBotUser):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "Discord bot identity is already configured")
	case errors.Is(err, discordstore.ErrInvalidBotToken):
		WriteProblem(w, r, http.StatusBadGateway, "Bad Gateway", "configured Discord token did not resolve to a bot account")
	case errors.Is(err, blobstore.ErrNoUsableBot):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "Discord bot is temporarily unavailable")
	default:
		var upstream *discordstore.UpstreamError
		if !errors.As(err, &upstream) {
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "bot runtime operation failed")
			return
		}

		switch upstream.Class {
		case discordstore.ErrorRateLimited, discordstore.ErrorTimeout, discordstore.ErrorUnavailable:
			WriteProblem(w, r, http.StatusServiceUnavailable, "Service Unavailable", "Discord bot probe is temporarily unavailable")
		default:
			WriteProblem(w, r, http.StatusBadGateway, "Bad Gateway", "Discord bot probe failed")
		}
	}
}
