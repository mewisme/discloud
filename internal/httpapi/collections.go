package httpapi

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/collections"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/cursor"
	"github.com/mewisme/discloud/internal/nodes"
)

type createCollectionRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type updateCollectionRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

type restoreCollectionRequest struct {
	Name string `json:"name,omitempty"`
}

type addCollectionItemRequest struct {
	FileID string `json:"fileId"`
}

type collectionResponse struct {
	ID          string    `json:"id"`
	OwnerUserID string    `json:"ownerUserId"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type collectionItemResponse struct {
	FileID      string    `json:"fileId"`
	OwnerUserID string    `json:"ownerUserId"`
	Name        string    `json:"name"`
	Size        int64     `json:"size"`
	SHA256      string    `json:"sha256,omitempty"`
	MIMEType    string    `json:"mimeType"`
	Category    string    `json:"category"`
	AddedBy     string    `json:"addedBy"`
	AddedAt     time.Time `json:"addedAt"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func registerCollectionRoutes(mux *http.ServeMux, service *collections.Service, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}

	protected("GET /api/v1/collections", func(w http.ResponseWriter, r *http.Request) {
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

		items, hasMore, err := service.List(r.Context(), collectionActor(r), limit, afterNameKey, afterID)
		if writeCollectionError(w, r, err) {
			return
		}

		response := make([]collectionResponse, len(items))
		for i, item := range items {
			response[i] = collectionJSON(item)
		}

		var nextCursor string
		if hasMore && len(items) > 0 {
			last := items[len(items)-1]
			nextCursor = cursor.Encode(last.NameKey, last.ID)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Collections []collectionResponse `json:"collections"`
			NextCursor  string               `json:"nextCursor,omitempty"`
		}{response, nextCursor})
	})

	protected("POST /api/v1/collections", func(w http.ResponseWriter, r *http.Request) {
		var input createCollectionRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		collection, err := service.Create(r.Context(), collectionActor(r), input.Name, input.Description)
		if writeCollectionError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(collectionJSON(collection))
	})

	protected("GET /api/v1/collections/{collectionId}", func(w http.ResponseWriter, r *http.Request) {
		collection, err := service.Get(r.Context(), collectionActor(r), r.PathValue("collectionId"))
		if writeCollectionError(w, r, err) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(collectionJSON(collection))
	})

	protected("PATCH /api/v1/collections/{collectionId}", func(w http.ResponseWriter, r *http.Request) {
		var input updateCollectionRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}
		if input.Name == nil && input.Description == nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "provide name or description")
			return
		}

		collection, err := service.Update(r.Context(), collectionActor(r), r.PathValue("collectionId"), collections.UpdateInput{
			Name: input.Name, Description: input.Description,
		})
		if writeCollectionError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(collectionJSON(collection))
	})

	protected("DELETE /api/v1/collections/{collectionId}", func(w http.ResponseWriter, r *http.Request) {
		if writeCollectionError(w, r, service.Trash(r.Context(), collectionActor(r), r.PathValue("collectionId"))) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	protected("POST /api/v1/collections/{collectionId}/restore", func(w http.ResponseWriter, r *http.Request) {
		var input restoreCollectionRequest
		if r.ContentLength != 0 {
			if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
				WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
				return
			}
		}

		collection, err := service.Restore(r.Context(), collectionActor(r), r.PathValue("collectionId"), input.Name)
		if writeCollectionError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(collectionJSON(collection))
	})

	protected("GET /api/v1/collections/{collectionId}/items", func(w http.ResponseWriter, r *http.Request) {
		items, err := service.ListItems(r.Context(), collectionActor(r), r.PathValue("collectionId"))
		if writeCollectionError(w, r, err) {
			return
		}

		response := make([]collectionItemResponse, len(items))
		for i, item := range items {
			response[i] = collectionItemJSON(item)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Items []collectionItemResponse `json:"items"`
		}{response})
	})

	protected("POST /api/v1/collections/{collectionId}/items", func(w http.ResponseWriter, r *http.Request) {
		var input addCollectionItemRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}
		if input.FileID == "" {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "fileId is required")
			return
		}

		created, err := service.AddItem(r.Context(), collectionActor(r), r.PathValue("collectionId"), input.FileID)
		if writeCollectionError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if created {
			w.WriteHeader(http.StatusCreated)
		}
		_ = json.NewEncoder(w).Encode(struct {
			Created bool `json:"created"`
		}{created})
	})

	protected("DELETE /api/v1/collections/{collectionId}/items/{fileId}", func(w http.ResponseWriter, r *http.Request) {
		err := service.RemoveItem(r.Context(), collectionActor(r), r.PathValue("collectionId"), r.PathValue("fileId"))
		if writeCollectionError(w, r, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func collectionActor(r *http.Request) collections.Actor {
	principal := currentPrincipal(r.Context())
	return collections.Actor{UserID: principal.User.ID, Admin: principal.User.Role == "admin"}
}

func collectionJSON(collection collections.Collection) collectionResponse {
	return collectionResponse{
		ID: collection.ID, OwnerUserID: collection.OwnerID, Name: collection.Name,
		Description: collection.Description, CreatedAt: collection.CreatedAt, UpdatedAt: collection.UpdatedAt,
	}
}

func collectionItemJSON(item collections.Item) collectionItemResponse {
	response := collectionItemResponse{
		FileID: item.FileID, OwnerUserID: item.OwnerUserID, Name: item.Name, Size: item.SizeBytes,
		MIMEType: item.MIMEType, Category: item.Category, AddedBy: item.AddedBy,
		AddedAt: item.AddedAt, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
	}
	if len(item.SHA256) == 32 {
		response.SHA256 = hex.EncodeToString(item.SHA256)
	}
	return response
}

func writeCollectionError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}

	switch {
	case errors.Is(err, collections.ErrNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "collection not found")
	case errors.Is(err, collections.ErrForbidden):
		WriteProblem(w, r, http.StatusForbidden, "Forbidden", "insufficient collection permission")
	case errors.Is(err, collections.ErrFileNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "file not found")
	case errors.Is(err, collections.ErrItemNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "collection item not found")
	case errors.Is(err, collections.ErrGrantNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "collection access grant not found")
	case errors.Is(err, collections.ErrUserNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "user not found")
	case errors.Is(err, nodes.ErrInvalidName), errors.Is(err, collections.ErrInvalidLevel), errors.Is(err, collections.ErrInvalidCursor):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", err.Error())
	case errors.Is(err, collections.ErrOwnerGrant):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "collection owner already has full access")
	case errors.Is(err, collections.ErrNameConflict):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "a collection with that name already exists")
	case errors.Is(err, collections.ErrNotDeleted):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "collection is not in trash")
	default:
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not manage collection")
	}
	return true
}
