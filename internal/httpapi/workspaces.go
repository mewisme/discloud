package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/mewisme/discloud/internal/adminusers"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
)

type workspaceOwnerResponse struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Status   string `json:"status"`
}

type workspaceRootResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type workspaceResponse struct {
	Owner workspaceOwnerResponse `json:"owner"`
	Root  workspaceRootResponse  `json:"root"`
	Usage adminUsageResponse     `json:"usage"`
}

func registerWorkspaceRoutes(mux *http.ServeMux, service *adminusers.Service, authService *auth.Service, cfg config.AuthConfig) {
	mux.Handle("GET /api/v1/workspaces/{username}", requireAuth(authService, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal := currentPrincipal(r.Context())
		username := strings.TrimSpace(r.PathValue("username"))

		if principal.User.Role != "admin" && !strings.EqualFold(username, principal.User.Username) {
			WriteProblem(w, r, http.StatusForbidden, "Forbidden", "workspace access denied")
			return
		}

		owner, err := service.GetByUsername(r.Context(), username)
		if errors.Is(err, adminusers.ErrUserNotFound) {
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "workspace not found")
			return
		}
		if err != nil {
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not load workspace")
			return
		}

		usage, err := service.Usage(r.Context(), owner.ID)
		if err != nil {
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not load workspace usage")
			return
		}

		root, err := service.Root(r.Context(), owner.ID)
		if err != nil {
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not load workspace root")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(workspaceResponse{
			Owner: workspaceOwnerResponse{
				ID: owner.ID, Username: owner.Username, Name: owner.Name, Role: owner.Role, Status: owner.Status,
			},
			Root: workspaceRootResponse{
				ID: root.ID, Name: root.Name,
			},
			Usage: adminUsageResponse{
				QuotaBytes: usage.QuotaBytes, UsedBytes: usage.UsedBytes, ReservedBytes: usage.ReservedBytes,
				AvailableBytes: usage.AvailableBytes, OverQuota: usage.OverQuota,
			},
		})
	})))
}
