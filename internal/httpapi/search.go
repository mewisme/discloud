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
	"github.com/mewisme/discloud/internal/search"
)

type searchResultResponse struct {
	ID           string    `json:"id"`
	Kind         string    `json:"kind"`
	OwnerUserID  string    `json:"ownerUserId"`
	ParentID     *string   `json:"parentId,omitempty"`
	CollectionID string    `json:"collectionId,omitempty"`
	Name         string    `json:"name"`
	IsFavorite   bool      `json:"isFavorite"`
	Shared       bool      `json:"shared"`
	Size         *int64    `json:"size,omitempty"`
	MIMEType     string    `json:"mimeType,omitempty"`
	Category     string    `json:"category,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

func registerSearchRoutes(mux *http.ServeMux, service *search.Service, authService *auth.Service, cfg config.AuthConfig) {
	mux.Handle("GET /api/v1/search", requireAuth(authService, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		input, err := searchInput(r)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid search query")
			return
		}

		page, err := service.Search(r.Context(), searchActor(r), input)
		if writeSearchError(w, r, err) {
			return
		}

		results := make([]searchResultResponse, len(page.Items))
		for i, item := range page.Items {
			results[i] = searchResultJSON(item)
		}

		var nextCursor string
		if page.HasMore && len(page.Items) > 0 {
			last := page.Items[len(page.Items)-1]
			nextCursor = cursor.Encode(last.CursorKey, last.ID)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Results    []searchResultResponse `json:"results"`
			NextCursor string                 `json:"nextCursor,omitempty"`
		}{
			Results:    results,
			NextCursor: nextCursor,
		})
	})))
}

func searchInput(r *http.Request) (search.Input, error) {
	limit, err := nodeListLimit(r)
	if err != nil {
		return search.Input{}, err
	}

	query := r.URL.Query()
	input := search.Input{
		Query:        query.Get("q"),
		Kind:         query.Get("kind"),
		MIMEType:     query.Get("mimeType"),
		Category:     query.Get("category"),
		OwnerID:      query.Get("ownerId"),
		FolderID:     query.Get("folderId"),
		CollectionID: query.Get("collectionId"),
		State:        search.State(query.Get("state")),
		Sort:         search.Sort(query.Get("sort")),
		Order:        search.Order(query.Get("order")),
		Limit:        limit,
	}

	if input.Favorite, err = searchBoolParam(query.Get("favorite")); err != nil {
		return search.Input{}, err
	}
	if input.Shared, err = searchBoolParam(query.Get("shared")); err != nil {
		return search.Input{}, err
	}
	if input.MinSize, err = searchInt64Param(query.Get("minSize")); err != nil {
		return search.Input{}, err
	}
	if input.MaxSize, err = searchInt64Param(query.Get("maxSize")); err != nil {
		return search.Input{}, err
	}
	if input.CreatedFrom, err = searchTimeParam(query.Get("createdFrom")); err != nil {
		return search.Input{}, err
	}
	if input.CreatedTo, err = searchTimeParam(query.Get("createdTo")); err != nil {
		return search.Input{}, err
	}
	if input.UpdatedFrom, err = searchTimeParam(query.Get("updatedFrom")); err != nil {
		return search.Input{}, err
	}
	if input.UpdatedTo, err = searchTimeParam(query.Get("updatedTo")); err != nil {
		return search.Input{}, err
	}

	if raw := query.Get("cursor"); raw != "" {
		parts, err := cursor.Decode(raw, 2)
		if err != nil {
			return search.Input{}, err
		}
		input.AfterKey, input.AfterID = parts[0], parts[1]
	}

	return input, nil
}

func searchBoolParam(value string) (*bool, error) {
	if value == "" {
		return nil, nil
	}

	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func searchInt64Param(value string) (*int64, error) {
	if value == "" {
		return nil, nil
	}

	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func searchTimeParam(value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}

	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func searchActor(r *http.Request) search.Actor {
	principal := currentPrincipal(r.Context())
	return search.Actor{
		UserID: principal.User.ID,
		Admin:  principal.User.Role == "admin",
	}
}

func searchResultJSON(item search.Result) searchResultResponse {
	var parentID *string
	if item.ParentID != "" {
		value := item.ParentID
		parentID = &value
	}

	return searchResultResponse{
		ID:           item.ID,
		Kind:         item.Kind,
		OwnerUserID:  item.OwnerID,
		ParentID:     parentID,
		CollectionID: item.AccessCollectionID,
		Name:         item.Name,
		IsFavorite:   item.IsFavorite,
		Shared:       item.Shared,
		Size:         item.SizeBytes,
		MIMEType:     item.MIMEType,
		Category:     item.Category,
		CreatedAt:    item.CreatedAt,
		UpdatedAt:    item.UpdatedAt,
	}
}

func writeSearchError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}

	switch {
	case errors.Is(err, search.ErrForbidden):
		WriteProblem(w, r, http.StatusForbidden, "Forbidden", "search filter is not allowed")
	case errors.Is(err, search.ErrInvalidQuery), errors.Is(err, search.ErrInvalidCursor):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid search query")
	default:
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not search resources")
	}
	return true
}
