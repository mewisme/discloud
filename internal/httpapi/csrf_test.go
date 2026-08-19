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
		{
			name:   "safe cross origin",
			method: http.MethodGet,
			headers: map[string]string{
				"Origin": "https://evil.example",
			},
			want: http.StatusNoContent,
		},
		{
			name:   "same origin",
			method: http.MethodPost,
			headers: map[string]string{
				"Origin":         "https://files.example.com",
				"Sec-Fetch-Site": "same-origin",
			},
			want: http.StatusNoContent,
		},
		{
			name:   "same referer",
			method: http.MethodPost,
			headers: map[string]string{
				"Referer":        "https://files.example.com/page",
				"Sec-Fetch-Site": "same-origin",
			},
			want: http.StatusNoContent,
		},
		{
			name:   "cross origin",
			method: http.MethodPost,
			headers: map[string]string{
				"Origin": "https://evil.example",
			},
			want: http.StatusForbidden,
		},
		{
			name:   "cross referer",
			method: http.MethodDelete,
			headers: map[string]string{
				"Referer": "https://evil.example/page",
			},
			want: http.StatusForbidden,
		},
		{
			name:   "null origin",
			method: http.MethodPost,
			headers: map[string]string{
				"Origin": "null",
			},
			want: http.StatusForbidden,
		},
		{
			name:   "cross site fetch",
			method: http.MethodPost,
			headers: map[string]string{
				"Sec-Fetch-Site": "cross-site",
			},
			want: http.StatusForbidden,
		},
		{
			name:   "same site sibling",
			method: http.MethodPost,
			headers: map[string]string{
				"Sec-Fetch-Site": "same-site",
			},
			want: http.StatusForbidden,
		},
		{
			name:   "cross site wins over spoofed origin",
			method: http.MethodPost,
			headers: map[string]string{
				"Origin":         "https://files.example.com",
				"Sec-Fetch-Site": "cross-site",
			},
			want: http.StatusForbidden,
		},
		{
			name:   "same origin fetch fallback",
			method: http.MethodPost,
			headers: map[string]string{
				"Sec-Fetch-Site": "same-origin",
			},
			want: http.StatusNoContent,
		},
		{
			name:   "user initiated fetch",
			method: http.MethodPost,
			headers: map[string]string{
				"Sec-Fetch-Site": "none",
			},
			want: http.StatusNoContent,
		},
		{
			name:   "unknown fetch metadata",
			method: http.MethodPost,
			headers: map[string]string{
				"Sec-Fetch-Site": "unknown",
			},
			want: http.StatusForbidden,
		},
		{
			name:   "non browser",
			method: http.MethodPost,
			want:   http.StatusNoContent,
		},
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := RequestIDMiddleware(csrfMiddleware(cfg, next))

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(
				tt.method,
				"https://files.example.com/api/v1/test",
				nil,
			)

			for key, value := range tt.headers {
				req.Header.Set(key, value)
			}

			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tt.want {
				t.Fatalf(
					"status = %d, want %d",
					rec.Code,
					tt.want,
				)
			}
			if rec.Header().Get(RequestIDHeader) == "" {
				t.Fatal("request ID is missing")
			}
		})
	}
}

func TestCSRFUsesRequestOriginWithoutPublicURL(t *testing.T) {
	req := httptest.NewRequest(
		http.MethodPost,
		"https://files.example.com/api/v1/test",
		nil,
	)
	req.Header.Set("Origin", "https://files.example.com")
	req.Header.Set("Sec-Fetch-Site", "same-origin")

	rec := httptest.NewRecorder()

	csrfMiddleware(
		config.HTTPConfig{},
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}),
	).ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf(
			"status = %d, want %d",
			rec.Code,
			http.StatusNoContent,
		)
	}
}
