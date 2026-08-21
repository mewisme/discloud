package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/settings"
)

const settingsBodyLimit = 64 << 10

type updateCommonConfigRequest struct {
	Timezone           string                             `json:"timezone"`
	FileBrowserToolbar *settings.FileBrowserToolbarConfig `json:"fileBrowserToolbar"`
	FilePreview        *settings.FilePreviewConfig        `json:"filePreview"`
	Sidebar            *settings.SidebarConfig            `json:"sidebar"`
}

type setAppConfigRequest struct {
	Value json.RawMessage `json:"value"`
}

func registerSettingsRoutes(mux *http.ServeMux, service *settings.Service, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}
	admin := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAdmin(authService, cfg, handler))
	}

	protected("GET /api/v1/me/config", func(w http.ResponseWriter, r *http.Request) {
		result, err := service.GetUserConfig(r.Context(), currentPrincipal(r.Context()).User.ID)
		if writeSettingsError(w, r, err) {
			return
		}

		writeSettingsJSON(w, http.StatusOK, result)
	})

	protected("PUT /api/v1/me/config/common", func(w http.ResponseWriter, r *http.Request) {
		var input updateCommonConfigRequest
		if err := decodeJSON(w, r, settingsBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		result, err := service.UpdateCommonUserConfig(
			r.Context(),
			currentPrincipal(r.Context()).User.ID,
			settings.CommonUserConfigPatch{
				Timezone:           input.Timezone,
				FileBrowserToolbar: input.FileBrowserToolbar,
				FilePreview:        input.FilePreview,
				Sidebar:            input.Sidebar,
			},
		)
		if writeSettingsError(w, r, err) {
			return
		}

		writeSettingsJSON(w, http.StatusOK, result)
	})

	admin("GET /api/v1/admin/config", func(w http.ResponseWriter, r *http.Request) {
		result, err := service.ListAppConfig(r.Context(), r.URL.Query().Get("prefix"))
		if writeSettingsError(w, r, err) {
			return
		}

		writeSettingsJSON(w, http.StatusOK, result)
	})

	admin("GET /api/v1/admin/config/{key}", func(w http.ResponseWriter, r *http.Request) {
		result, err := service.GetAppConfig(r.Context(), r.PathValue("key"))
		if writeSettingsError(w, r, err) {
			return
		}

		writeSettingsJSON(w, http.StatusOK, result)
	})

	admin("PUT /api/v1/admin/config/{key}", func(w http.ResponseWriter, r *http.Request) {
		var input setAppConfigRequest
		if err := decodeJSON(w, r, settingsBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		result, err := service.SetAppConfig(
			r.Context(),
			currentPrincipal(r.Context()).User.ID,
			r.PathValue("key"),
			input.Value,
		)
		if writeSettingsError(w, r, err) {
			return
		}

		writeSettingsJSON(w, http.StatusOK, result)
	})

	admin("DELETE /api/v1/admin/config/{key}", func(w http.ResponseWriter, r *http.Request) {
		err := service.DeleteAppConfig(
			r.Context(),
			currentPrincipal(r.Context()).User.ID,
			r.PathValue("key"),
		)
		if writeSettingsError(w, r, err) {
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
}

func writeSettingsError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, settings.ErrInvalidTimezone):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid timezone")
	case errors.Is(err, settings.ErrInvalidFileBrowserToolbar):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid file browser toolbar configuration")
	case errors.Is(err, settings.ErrInvalidFilePreview):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid file preview configuration")
	case errors.Is(err, settings.ErrInvalidSidebar):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid sidebar configuration")
	case errors.Is(err, settings.ErrInvalidConfigKey):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid app config key")
	case errors.Is(err, settings.ErrInvalidConfigValue):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid app config value")
	case errors.Is(err, settings.ErrAppConfigNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "app config not found")
	default:
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not process settings")
	}

	return true
}

func writeSettingsJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
