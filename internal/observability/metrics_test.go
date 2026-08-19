package observability

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"
)

func TestMetricsHTTPExposition(t *testing.T) {
	metrics := NewMetrics(nil)

	metrics.BeginHTTP()
	metrics.EndHTTP(
		"GET",
		"/api/v1/files/{fileId}/content",
		206,
		75*time.Millisecond,
	)

	var output bytes.Buffer
	if err := metrics.WritePrometheus(context.Background(), &output); err != nil {
		t.Fatalf("WritePrometheus(): %v", err)
	}

	text := output.String()

	wants := []string{
		`discloud_http_requests_total{method="GET",route="/api/v1/files/{fileId}/content",status="206"} 1`,
		`discloud_http_request_duration_seconds_bucket{method="GET",route="/api/v1/files/{fileId}/content",le="0.1"} 1`,
		`discloud_http_request_duration_seconds_bucket{method="GET",route="/api/v1/files/{fileId}/content",le="+Inf"} 1`,
		`discloud_http_request_duration_seconds_count{method="GET",route="/api/v1/files/{fileId}/content"} 1`,
	}

	for _, want := range wants {
		if !strings.Contains(text, want) {
			t.Fatalf("metrics missing %q:\n%s", want, text)
		}
	}
}

func TestEscapeLabel(t *testing.T) {
	got := escapeLabel("a\"b\\c\nd")
	want := `a\"b\\c\nd`

	if got != want {
		t.Fatalf("escapeLabel() = %q, want %q", got, want)
	}
}
