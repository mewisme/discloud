package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/cursor"
	"github.com/mewisme/discloud/internal/nodes"
)

type restoreNodeRequest struct {
	ParentFolderID string `json:"parentFolderId,omitempty"`
	Name           string `json:"name,omitempty"`
}

type trashItemResponse struct {
	Node      nodeResponse `json:"node"`
	DeletedAt time.Time    `json:"deletedAt"`
	DeletedBy string       `json:"deletedBy,omitempty"`
	SizeBytes *int64       `json:"sizeBytes,omitempty"`
}

func registerTrashRoutes(mux *http.ServeMux, service *nodes.Service, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}

	protected("DELETE /api/v1/files/{fileId}", func(w http.ResponseWriter, r *http.Request) {
		if writeTrashError(w, r, service.TrashKind(r.Context(), nodeActor(r), r.PathValue("fileId"), "file")) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	protected("DELETE /api/v1/folders/{folderId}", func(w http.ResponseWriter, r *http.Request) {
		if writeTrashError(w, r, service.TrashKind(r.Context(), nodeActor(r), r.PathValue("folderId"), "folder")) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	protected("POST /api/v1/files/{fileId}/restore", func(w http.ResponseWriter, r *http.Request) {
		restoreNode(w, r, service, "file", r.PathValue("fileId"))
	})

	protected("POST /api/v1/folders/{folderId}/restore", func(w http.ResponseWriter, r *http.Request) {
		restoreNode(w, r, service, "folder", r.PathValue("folderId"))
	})

	protected("GET /api/v1/trash", func(w http.ResponseWriter, r *http.Request) {
		limit, err := nodeListLimit(r)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid limit")
			return
		}

		var before *time.Time
		var beforeID string
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			parts, err := cursor.Decode(raw, 2)
			if err != nil {
				WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid cursor")
				return
			}

			value, err := time.Parse(time.RFC3339Nano, parts[0])
			if err != nil {
				WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid cursor")
				return
			}
			before, beforeID = &value, parts[1]
		}

		items, hasMore, err := service.ListTrash(
			r.Context(),
			nodeActor(r),
			r.URL.Query().Get("ownerId"),
			limit,
			before,
			beforeID,
		)
		if writeTrashError(w, r, err) {
			return
		}

		response := make([]trashItemResponse, len(items))
		for i, item := range items {
			response[i] = trashItemResponse{
				Node:      nodeJSON(item.Node),
				DeletedAt: item.DeletedAt,
				DeletedBy: item.DeletedBy,
				SizeBytes: item.SizeBytes,
			}
		}

		var nextCursor string
		if hasMore && len(items) > 0 {
			last := items[len(items)-1]
			nextCursor = cursor.Encode(last.DeletedAt.Format(time.RFC3339Nano), last.ID)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Items      []trashItemResponse `json:"items"`
			NextCursor string              `json:"nextCursor,omitempty"`
		}{
			Items:      response,
			NextCursor: nextCursor,
		})
	})
}

func restoreNode(w http.ResponseWriter, r *http.Request, service *nodes.Service, kind, nodeID string) {
	var input restoreNodeRequest
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}
	}

	node, err := service.RestoreKind(r.Context(), nodeActor(r), nodeID, kind, nodes.RestoreInput{
		ParentID: input.ParentFolderID,
		Name:     input.Name,
	})
	if writeTrashError(w, r, err) {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(nodeJSON(node))
}

func writeTrashError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}

	switch {
	case errors.Is(err, nodes.ErrNotDeleted):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "node is not in trash")
	case errors.Is(err, nodes.ErrRestoreTarget):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "restore destination is unavailable")
	case errors.Is(err, nodes.ErrQuotaExceeded):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "storage quota exceeded")
	case errors.Is(err, nodes.ErrInvalidTrashQuery):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid trash query")
	case errors.Is(err, nodes.ErrQuotaInvariant):
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "storage quota state is inconsistent")
	default:
		return writeNodeError(w, r, err)
	}
	return true
}
