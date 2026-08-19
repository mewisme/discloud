package httpapi

import (
	"net/http/httptest"
	"testing"

	"github.com/mewisme/discloud/internal/cursor"
	"github.com/mewisme/discloud/internal/nodes"
)

func TestNodeListOptions(t *testing.T) {
	const id = "00000000-0000-7000-8000-000000000001"

	tests := []struct {
		name string
		url  string
		want nodes.BrowserListOptions
		err  bool
	}{
		{
			name: "defaults",
			url:  "/api/v1/folders/" + id + "/children",
			want: nodes.BrowserListOptions{Limit: 50, Sort: nodes.BrowserSortName, Order: nodes.BrowserOrderAsc},
		},
		{
			name: "name cursor",
			url:  "/api/v1/folders/" + id + "/children?limit=25&cursor=" + cursor.Encode("documents", id),
			want: nodes.BrowserListOptions{Limit: 25, Sort: nodes.BrowserSortName, Order: nodes.BrowserOrderAsc, AfterValue: "documents", AfterID: id},
		},
		{
			name: "size descending",
			url:  "/api/v1/folders/" + id + "/children?sort=size&order=desc&cursor=" + cursor.Encode("42", "photo.jpg", id),
			want: nodes.BrowserListOptions{Limit: 50, Sort: nodes.BrowserSortSize, Order: nodes.BrowserOrderDesc, AfterValue: "42", AfterNameKey: "photo.jpg", AfterID: id},
		},
		{
			name: "invalid sort",
			url:  "/api/v1/folders/" + id + "/children?sort=relevance",
			err:  true,
		},
		{
			name: "invalid order",
			url:  "/api/v1/folders/" + id + "/children?order=random",
			err:  true,
		},
		{
			name: "invalid cursor",
			url:  "/api/v1/folders/" + id + "/children?cursor=broken",
			err:  true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", test.url, nil)
			got, err := nodeListOptions(request)
			if test.err {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("nodeListOptions: %v", err)
			}
			if got != test.want {
				t.Fatalf("options = %+v, want %+v", got, test.want)
			}
		})
	}
}
