package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/cursor"
	"github.com/mewisme/discloud/internal/nodes"
)

type createFolderRequest struct {
	ParentID string `json:"parentId"`
	Name     string `json:"name"`
}

type updateFolderRequest struct {
	Name     *string `json:"name"`
	ParentID *string `json:"parentId"`
}

type nodeResponse struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"`
	OwnerUserID string    `json:"ownerUserId"`
	ParentID    *string   `json:"parentId"`
	Name        string    `json:"name"`
	IsRoot      bool      `json:"isRoot"`
	IsFavorite  bool      `json:"isFavorite"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func registerNodeRoutes(mux *http.ServeMux, service *nodes.Service, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}

	protected("POST /api/v1/folders", func(w http.ResponseWriter, r *http.Request) {
		var input createFolderRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		node, err := service.CreateFolder(
			r.Context(),
			nodeActor(r),
			input.ParentID,
			input.Name,
		)
		if writeNodeError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(nodeJSON(node))
	})

	protected("GET /api/v1/folders/{folderId}", func(w http.ResponseWriter, r *http.Request) {
		node, err := service.Get(r.Context(), nodeActor(r), r.PathValue("folderId"))
		if err == nil && node.Kind != "folder" {
			err = nodes.ErrNotFound
		}
		if writeNodeError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(nodeJSON(node))
	})

	protected("GET /api/v1/folders/{folderId}/children", func(w http.ResponseWriter, r *http.Request) {
		limit, err := nodeListLimit(r)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid limit")
			return
		}

		var afterNameKey, afterID string
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			parts, err := cursor.Decode(raw, 2)
			if err != nil {
				WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid cursor")
				return
			}
			afterNameKey, afterID = parts[0], parts[1]
		}

		children, hasMore, err := service.ListChildren(
			r.Context(),
			nodeActor(r),
			r.PathValue("folderId"),
			limit,
			afterNameKey,
			afterID,
		)
		if writeNodeError(w, r, err) {
			return
		}

		response := make([]nodeResponse, len(children))
		for i, child := range children {
			response[i] = nodeJSON(child)
		}

		var nextCursor string
		if hasMore && len(children) > 0 {
			last := children[len(children)-1]
			nextCursor = cursor.Encode(last.NameKey, last.ID)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Nodes      []nodeResponse `json:"nodes"`
			NextCursor string         `json:"nextCursor,omitempty"`
		}{
			Nodes:      response,
			NextCursor: nextCursor,
		})
	})

	protected("GET /api/v1/folders/{folderId}/breadcrumbs", func(w http.ResponseWriter, r *http.Request) {
		items, err := service.Breadcrumbs(r.Context(), nodeActor(r), r.PathValue("folderId"))
		if writeNodeError(w, r, err) {
			return
		}

		response := make([]nodeResponse, len(items))
		for i, item := range items {
			response[i] = nodeJSON(item)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Breadcrumbs []nodeResponse `json:"breadcrumbs"`
		}{response})
	})

	protected("PATCH /api/v1/folders/{folderId}", func(w http.ResponseWriter, r *http.Request) {
		var input updateFolderRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		if (input.Name == nil) == (input.ParentID == nil) {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "provide exactly one of name or parentId")
			return
		}

		var (
			node nodes.Node
			err  error
		)

		if input.Name != nil {
			node, err = service.Rename(
				r.Context(),
				nodeActor(r),
				r.PathValue("folderId"),
				*input.Name,
			)
		} else {
			node, err = service.Move(
				r.Context(),
				nodeActor(r),
				r.PathValue("folderId"),
				*input.ParentID,
			)
		}

		if err == nil && node.Kind != "folder" {
			err = nodes.ErrNotFound
		}
		if writeNodeError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(nodeJSON(node))
	})
}

func nodeActor(r *http.Request) nodes.Actor {
	principal := currentPrincipal(r.Context())
	return nodes.Actor{
		UserID: principal.User.ID,
		Admin:  principal.User.Role == "admin",
	}
}

func nodeJSON(node nodes.Node) nodeResponse {
	var parentID *string
	if node.ParentID != "" {
		value := node.ParentID
		parentID = &value
	}

	return nodeResponse{
		ID:          node.ID,
		Kind:        node.Kind,
		OwnerUserID: node.OwnerID,
		ParentID:    parentID,
		Name:        node.Name,
		IsRoot:      node.IsRoot,
		IsFavorite:  node.IsFavorite,
		CreatedAt:   node.CreatedAt,
		UpdatedAt:   node.UpdatedAt,
	}
}

func writeNodeError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}

	switch {
	case errors.Is(err, nodes.ErrNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "node not found")
	case errors.Is(err, nodes.ErrInvalidName):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", err.Error())
	case errors.Is(err, nodes.ErrInvalidCursor):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid cursor")
	case errors.Is(err, nodes.ErrNotFolder):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "target is not a folder")
	case errors.Is(err, nodes.ErrNameConflict):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "a node with that name already exists")
	case errors.Is(err, nodes.ErrRootImmutable):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "root folder cannot be modified")
	case errors.Is(err, nodes.ErrCycle):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "folder cannot be moved into itself or its descendants")
	case errors.Is(err, nodes.ErrCrossOwner):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "cross-owner move requires ownership transfer")
	default:
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not manage node")
	}

	return true
}

func nodeListLimit(r *http.Request) (int, error) {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return 50, nil
	}

	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 100 {
		return 0, errors.New("invalid limit")
	}

	return limit, nil
}
