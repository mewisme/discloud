package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/nodes"
)

const folderBatchBodyLimit int64 = 1 << 20

type batchFolderRequest struct {
	ParentFolderID string                   `json:"parentFolderId"`
	Folders        []batchFolderRequestItem `json:"folders"`
}

type batchFolderRequestItem struct {
	ClientID       string `json:"clientId"`
	ParentClientID string `json:"parentClientId,omitempty"`
	Name           string `json:"name"`
}

type batchFolderResponseItem struct {
	ClientID string `json:"clientId"`
	FolderID string `json:"folderId"`
	Created  bool   `json:"created"`
}

func registerFolderBatchRoutes(mux *http.ServeMux, service *nodes.Service, authService *auth.Service, cfg config.AuthConfig) {
	mux.Handle("POST /api/v1/folders/batch", requireAuth(authService, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input batchFolderRequest
		if err := decodeJSON(w, r, folderBatchBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		folders := make([]nodes.BatchFolderInput, len(input.Folders))
		for i, folder := range input.Folders {
			folders[i] = nodes.BatchFolderInput{
				ClientID: folder.ClientID, ParentClientID: folder.ParentClientID, Name: folder.Name,
			}
		}

		results, err := service.CreateFolderBatch(r.Context(), nodeActor(r), input.ParentFolderID, folders)
		if errors.Is(err, nodes.ErrInvalidBatch) {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid folder tree")
			return
		}
		if writeNodeError(w, r, err) {
			return
		}

		response := make([]batchFolderResponseItem, len(results))
		for i, result := range results {
			response[i] = batchFolderResponseItem{
				ClientID: result.ClientID, FolderID: result.Node.ID, Created: result.Created,
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Folders []batchFolderResponseItem `json:"folders"`
		}{Folders: response})
	})))
}
