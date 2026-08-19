package httpapi

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/cursor"
	"github.com/mewisme/discloud/internal/search"
)

func TestSearchInputParsesFilters(t *testing.T) {
	values := url.Values{
		"q":           {"report"},
		"kind":        {"file"},
		"mimeType":    {"application/pdf"},
		"category":    {"document"},
		"favorite":    {"true"},
		"shared":      {"false"},
		"minSize":     {"10"},
		"maxSize":     {"100"},
		"createdFrom": {"2026-08-01T00:00:00Z"},
		"updatedTo":   {"2026-08-19T00:00:00Z"},
		"sort":        {"size"},
		"order":       {"desc"},
		"limit":       {"25"},
		"cursor":      {cursor.Encode("42", "01900000-0000-7000-8000-000000000001")},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search?"+values.Encode(), nil)
	input, err := searchInput(req)
	if err != nil {
		t.Fatalf("searchInput(): %v", err)
	}

	if input.Query != "report" || input.Kind != "file" || input.MIMEType != "application/pdf" ||
		input.Category != "document" || input.Limit != 25 ||
		input.Sort != search.SortSize || input.Order != search.OrderDesc {
		t.Fatalf("unexpected input: %+v", input)
	}
	if input.Favorite == nil || !*input.Favorite {
		t.Fatal("favorite was not parsed")
	}
	if input.Shared == nil || *input.Shared {
		t.Fatal("shared was not parsed")
	}
	if input.MinSize == nil || *input.MinSize != 10 || input.MaxSize == nil || *input.MaxSize != 100 {
		t.Fatal("size range was not parsed")
	}
	if input.CreatedFrom == nil || input.UpdatedTo == nil {
		t.Fatal("time filters were not parsed")
	}
	if input.AfterKey != "42" || input.AfterID != "01900000-0000-7000-8000-000000000001" {
		t.Fatalf("cursor = %q, %q", input.AfterKey, input.AfterID)
	}
}

func TestSearchInputRejectsMalformedFilters(t *testing.T) {
	for _, rawURL := range []string{
		"/api/v1/search?favorite=maybe",
		"/api/v1/search?shared=yes",
		"/api/v1/search?minSize=nope",
		"/api/v1/search?maxSize=nope",
		"/api/v1/search?createdFrom=yesterday",
		"/api/v1/search?updatedTo=tomorrow",
		"/api/v1/search?limit=0",
		"/api/v1/search?cursor=invalid",
	} {
		req := httptest.NewRequest(http.MethodGet, rawURL, nil)
		if _, err := searchInput(req); err == nil {
			t.Fatalf("searchInput(%q) accepted invalid input", rawURL)
		}
	}
}

func TestSearchResultJSONHidesCollectionParent(t *testing.T) {
	now := time.Now()

	response := searchResultJSON(search.Result{
		ID:                 "file-id",
		Kind:               "file",
		OwnerID:            "owner-id",
		ParentID:           "private-parent",
		Name:               "secret.pdf",
		StructuralAccess:   false,
		AccessCollectionID: "collection-id",
		CreatedAt:          now,
		UpdatedAt:          now,
	})

	if response.ParentID != nil {
		t.Fatalf("collection-only result leaked parentId: %v", *response.ParentID)
	}
	if response.CollectionID != "collection-id" {
		t.Fatalf("collectionId = %q", response.CollectionID)
	}
}

func TestSearchResultJSONStructuralAccessUsesParent(t *testing.T) {
	response := searchResultJSON(search.Result{
		ID:                 "file-id",
		Kind:               "file",
		ParentID:           "folder-id",
		StructuralAccess:   true,
		AccessCollectionID: "collection-id",
	})

	if response.ParentID == nil || *response.ParentID != "folder-id" {
		t.Fatalf("parentId = %v", response.ParentID)
	}
	if response.CollectionID != "" {
		t.Fatalf("structural result exposed collection context %q", response.CollectionID)
	}
}
