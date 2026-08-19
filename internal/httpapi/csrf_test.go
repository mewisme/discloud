package httpapi

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/mewisme/discloud/internal/config"
)

func TestCSRFMiddleware(t *testing.T) {
	publicURL, err := url.Parse("https://files.example.com")
	if err != nil {
		t.Fatal(err)
	}

	cfg := config.HTTPConfig{PublicBaseURL: publicURL}
	tests := []struct {
		name    string
		method  string
		headers map[string]string
		want    int
	}{
		{"safe cross origin", http.MethodGet, map[string]string{"Origin": "https://evil.example"}, http.StatusNoContent},
		{"same origin", http.MethodPost, map[string]string{"Origin": "https://files.example.com"}, http.StatusNoContent},
		{"same referer", http.MethodPost, map[string]string{"Referer": "https://files.example.com/page"}, http.StatusNoContent},
		{"cross origin", http.MethodPost, map[string]string{"Origin": "https://evil.example"}, http.StatusForbidden},
		{"cross referer", http.MethodDelete, map[string]string{"Referer": "https://evil.example/page"}, http.StatusForbidden},
		{"null origin", http.MethodPost, map[string]string{"Origin": "null"}, http.StatusForbidden},
		{"cross site fetch", http.MethodPost, map[string]string{"Sec-Fetch-Site": "cross-site"}, http.StatusForbidden},
		{"non browser", http.MethodPost, nil, http.StatusNoContent},
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := RequestIDMiddleware(csrfMiddleware(cfg, next))

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "https://files.example.com/api/v1/test", nil)
			for key, value := range tt.headers {
				req.Header.Set(key, value)
			}

			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tt.want {
				t.Fatalf("status = %d, want %d", rec.Code, tt.want)
			}
			if rec.Header().Get(RequestIDHeader) == "" {
				t.Fatal("request ID is missing")
			}
		})
	}
}

func TestCSRFUsesRequestOriginWithoutPublicURL(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "https://files.example.com/api/v1/test", nil)
	req.Header.Set("Origin", "https://files.example.com")

	rec := httptest.NewRecorder()
	csrfMiddleware(config.HTTPConfig{}, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
}
