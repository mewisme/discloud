package httpapi

import (
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/collections"
	"github.com/mewisme/discloud/internal/config"
)

type sharedItemResponse struct {
	ID            string    `json:"id"`
	Kind          string    `json:"kind"`
	OwnerUserID   string    `json:"ownerUserId"`
	OwnerUsername string    `json:"ownerUsername"`
	OwnerName     string    `json:"ownerName"`
	Name          string    `json:"name"`
	Description   string    `json:"description,omitempty"`
	IsRoot        bool      `json:"isRoot"`
	AccessLevel   string    `json:"accessLevel"`
	SharedAt      time.Time `json:"sharedAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

func registerSharedRoutes(mux *http.ServeMux, folderACL *acl.Service, collectionService *collections.Service, authService *auth.Service, cfg config.AuthConfig) {
	mux.Handle("GET /api/v1/shared", requireAuth(authService, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := currentPrincipal(r.Context()).User.ID

		folders, err := folderACL.SharedWithUser(r.Context(), userID)
		if err != nil {
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not list shared items")
			return
		}

		collections, err := collectionService.SharedWithUser(r.Context(), userID)
		if err != nil {
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not list shared items")
			return
		}

		items := make([]sharedItemResponse, 0, len(folders)+len(collections))
		for _, folder := range folders {
			items = append(items, sharedItemResponse{
				ID: folder.ID, Kind: "folder", OwnerUserID: folder.OwnerUserID,
				OwnerUsername: folder.OwnerUsername, OwnerName: folder.OwnerName, Name: folder.Name, IsRoot: folder.IsRoot,
				AccessLevel: folder.Level.String(), SharedAt: folder.SharedAt, UpdatedAt: folder.UpdatedAt,
			})
		}
		for _, collection := range collections {
			items = append(items, sharedItemResponse{
				ID: collection.ID, Kind: "collection", OwnerUserID: collection.OwnerUserID,
				OwnerUsername: collection.OwnerUsername, OwnerName: collection.OwnerName, Name: collection.Name, Description: collection.Description,
				AccessLevel: collection.Level.String(), SharedAt: collection.SharedAt, UpdatedAt: collection.UpdatedAt,
			})
		}

		sort.Slice(items, func(i, j int) bool {
			if items[i].SharedAt.Equal(items[j].SharedAt) {
				return items[i].Name < items[j].Name
			}
			return items[i].SharedAt.After(items[j].SharedAt)
		})

		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Items []sharedItemResponse `json:"items"`
		}{items})
	})))
}
