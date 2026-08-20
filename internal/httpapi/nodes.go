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

type updateNodeRequest struct {
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

type folderChildResponse struct {
	nodeResponse
	Size            *int64 `json:"size,omitempty"`
	MIMEType        string `json:"mimeType,omitempty"`
	Extension       string `json:"extension,omitempty"`
	Category        string `json:"category,omitempty"`
	ThumbnailStatus string `json:"thumbnailStatus,omitempty"`
	AccessLevel     string `json:"accessLevel"`
	CanFavorite     bool   `json:"canFavorite"`
}

func registerNodeRoutes(mux *http.ServeMux, service *nodes.Service, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}

	protected("GET /api/v1/me/root", func(w http.ResponseWriter, r *http.Request) {
		node, err := service.Root(r.Context(), nodeActor(r))
		if writeNodeError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(nodeJSON(node))
	})

	protected("POST /api/v1/folders", func(w http.ResponseWriter, r *http.Request) {
		var input createFolderRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		node, err := service.CreateFolder(r.Context(), nodeActor(r), input.ParentID, input.Name)
		if writeNodeError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(nodeJSON(node))
	})

	protected("PATCH /api/v1/nodes/{nodeId}", updateNodeHandler(service, "nodeId", false))

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
		options, err := nodeListOptions(r)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", err.Error())
			return
		}

		children, hasMore, accessLevel, err := service.ListBrowserChildren(r.Context(), nodeActor(r), r.PathValue("folderId"), options)
		if writeNodeError(w, r, err) {
			return
		}

		response := make([]folderChildResponse, len(children))
		for i, child := range children {
			response[i] = folderChildJSON(child)
		}

		var nextCursor string
		if hasMore && len(children) > 0 {
			nextCursor = browserNodeCursor(children[len(children)-1], options.Sort)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Nodes       []folderChildResponse `json:"nodes"`
			AccessLevel string                `json:"accessLevel"`
			NextCursor  string                `json:"nextCursor,omitempty"`
		}{
			Nodes:       response,
			AccessLevel: accessLevel.String(),
			NextCursor:  nextCursor,
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

	protected("PATCH /api/v1/folders/{folderId}", updateNodeHandler(service, "folderId", true))
}

func updateNodeHandler(service *nodes.Service, pathParam string, folderOnly bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input updateNodeRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}
		if (input.Name == nil) == (input.ParentID == nil) {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "provide exactly one of name or parentId")
			return
		}

		nodeID := r.PathValue(pathParam)
		var (
			node nodes.Node
			err  error
		)
		if input.Name != nil {
			node, err = service.Rename(r.Context(), nodeActor(r), nodeID, *input.Name)
		} else {
			node, err = service.Move(r.Context(), nodeActor(r), nodeID, *input.ParentID)
		}

		if err == nil && folderOnly && node.Kind != "folder" {
			err = nodes.ErrNotFound
		}
		if writeNodeError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(nodeJSON(node))
	}
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

func folderChildJSON(node nodes.BrowserNode) folderChildResponse {
	return folderChildResponse{
		nodeResponse:    nodeJSON(node.Node),
		Size:            node.SizeBytes,
		MIMEType:        node.MIMEType,
		Extension:       node.Extension,
		Category:        node.Category,
		ThumbnailStatus: node.ThumbnailStatus,
		AccessLevel:     node.AccessLevel.String(),
		CanFavorite:     node.CanFavorite,
	}
}

func browserNodeCursor(node nodes.BrowserNode, sort nodes.BrowserSort) string {
	switch sort {
	case nodes.BrowserSortUpdated:
		return cursor.Encode(node.UpdatedAt.UTC().Format(time.RFC3339Nano), node.NameKey, node.ID)
	case nodes.BrowserSortSize:
		var size int64
		if node.SizeBytes != nil {
			size = *node.SizeBytes
		}
		return cursor.Encode(strconv.FormatInt(size, 10), node.NameKey, node.ID)
	default:
		return cursor.Encode(node.NameKey, node.ID)
	}
}

func nodeListOptions(r *http.Request) (nodes.BrowserListOptions, error) {
	options := nodes.BrowserListOptions{Limit: 50, Sort: nodes.BrowserSortName, Order: nodes.BrowserOrderAsc}

	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			return nodes.BrowserListOptions{}, errors.New("invalid limit")
		}
		options.Limit = limit
	}

	if raw := r.URL.Query().Get("sort"); raw != "" {
		options.Sort = nodes.BrowserSort(raw)
	}
	switch options.Sort {
	case nodes.BrowserSortName, nodes.BrowserSortUpdated, nodes.BrowserSortSize:
	default:
		return nodes.BrowserListOptions{}, errors.New("invalid sort")
	}

	if raw := r.URL.Query().Get("order"); raw != "" {
		options.Order = nodes.BrowserOrder(raw)
	}
	switch options.Order {
	case nodes.BrowserOrderAsc, nodes.BrowserOrderDesc:
	default:
		return nodes.BrowserListOptions{}, errors.New("invalid order")
	}

	rawCursor := r.URL.Query().Get("cursor")
	if rawCursor == "" {
		return options, nil
	}

	count := 2
	if options.Sort != nodes.BrowserSortName {
		count = 3
	}
	parts, err := cursor.Decode(rawCursor, count)
	if err != nil {
		return nodes.BrowserListOptions{}, errors.New("invalid cursor")
	}

	options.AfterValue = parts[0]
	if count == 2 {
		options.AfterID = parts[1]
	} else {
		options.AfterNameKey = parts[1]
		options.AfterID = parts[2]
	}
	return options, nil
}

func writeNodeError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}

	switch {
	case errors.Is(err, nodes.ErrNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "node not found")
	case errors.Is(err, nodes.ErrForbidden):
		WriteProblem(w, r, http.StatusForbidden, "Forbidden", "insufficient folder permission")
	case errors.Is(err, nodes.ErrInvalidName):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", err.Error())
	case errors.Is(err, nodes.ErrInvalidCursor):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid cursor")
	case errors.Is(err, nodes.ErrInvalidBrowserOptions):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid folder listing options")
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
