package httpapi

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mewisme/discloud/internal/observability"
)

func TestObservabilityMiddlewareContinuesTraceAndRecordsRoute(t *testing.T) {
	metrics := observability.NewMetrics(nil)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /things/{id}", func(w http.ResponseWriter, r *http.Request) {
		trace, ok := observability.TraceFromContext(r.Context())
		if !ok {
			t.Fatal("trace missing from context")
		}
		if trace.TraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
			t.Fatalf("TraceID = %q", trace.TraceID)
		}

		w.WriteHeader(http.StatusPartialContent)
	})

	handler := RequestIDMiddleware(
		observabilityMiddleware(metrics, logger, mux),
	)

	request := httptest.NewRequest(
		http.MethodGet,
		"/things/secret-resource-id",
		nil,
	)
	request.Header.Set(
		observability.TraceparentHeader,
		"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
	)

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusPartialContent {
		t.Fatalf("status = %d", response.Code)
	}

	traceparent := response.Header().Get(observability.TraceparentHeader)
	if !strings.HasPrefix(
		traceparent,
		"00-4bf92f3577b34da6a3ce929d0e0e4736-",
	) {
		t.Fatalf("traceparent = %q", traceparent)
	}

	var output bytes.Buffer
	if err := metrics.WritePrometheus(context.Background(), &output); err != nil {
		t.Fatalf("WritePrometheus(): %v", err)
	}

	text := output.String()
	if !strings.Contains(text, `route="/things/{id}"`) {
		t.Fatalf("route pattern missing:\n%s", text)
	}
	if strings.Contains(text, "secret-resource-id") {
		t.Fatalf("resource ID leaked into metrics:\n%s", text)
	}
}

func TestObservabilityMiddlewareDoesNotRecordMetricsEndpoint(t *testing.T) {
	metrics := observability.NewMetrics(nil)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/admin/metrics", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := RequestIDMiddleware(
		observabilityMiddleware(metrics, logger, mux),
	)

	request := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/admin/metrics",
		nil,
	)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}

	var output bytes.Buffer
	if err := metrics.WritePrometheus(context.Background(), &output); err != nil {
		t.Fatalf("WritePrometheus(): %v", err)
	}

	text := output.String()
	if strings.Contains(text, `route="/api/v1/admin/metrics"`) {
		t.Fatalf("metrics endpoint recorded itself:\n%s", text)
	}
	if strings.Contains(text, `route="unmatched"`) {
		t.Fatalf("metrics endpoint recorded itself as unmatched:\n%s", text)
	}
}
