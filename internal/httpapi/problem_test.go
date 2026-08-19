package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mewisme/discloud/internal/config"
)

func TestRequestIDMiddleware(t *testing.T) {
	var contextID string
	handler := RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contextID = RequestID(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	headerID := rec.Header().Get(RequestIDHeader)
	if headerID == "" {
		t.Fatal("request ID header is empty")
	}
	if contextID != headerID {
		t.Fatalf("context request ID = %q, header = %q", contextID, headerID)
	}
}

func TestReadyzProblem(t *testing.T) {
	router := NewRouter(
		func(context.Context) error { return errors.New("database unavailable") },
		nil,
		nil,
		config.HTTPConfig{},
		config.AuthConfig{},
	)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	if rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("Content-Type = %q", rec.Header().Get("Content-Type"))
	}

	var problem Problem
	if err := json.NewDecoder(rec.Body).Decode(&problem); err != nil {
		t.Fatalf("decode problem: %v", err)
	}
	if problem.Status != http.StatusServiceUnavailable || problem.RequestID == "" {
		t.Fatalf("problem = %+v", problem)
	}
}
