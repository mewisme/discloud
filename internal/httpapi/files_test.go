package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/files"
)

func TestSafeInlineMIME(t *testing.T) {
	for _, value := range []string{
		"application/pdf",
		"text/plain; charset=utf-8",
		"image/png",
		"audio/mpeg",
		"video/mp4",
	} {
		if !safeInlineMIME(value) {
			t.Fatalf("%q should be inline-safe", value)
		}
	}

	for _, value := range []string{
		"application/octet-stream",
		"text/html",
		"image/svg+xml",
		"application/javascript",
	} {
		if safeInlineMIME(value) {
			t.Fatalf("%q should not be inline-safe", value)
		}
	}
}

func TestSetFileHeadersForDownload(t *testing.T) {
	digest := make([]byte, 32)
	for i := range digest {
		digest[i] = byte(i)
	}
	updatedAt := time.Date(2026, time.August, 20, 1, 2, 3, 0, time.UTC)
	file := files.File{
		Name: "example file.bin", MIMEType: "application/octet-stream",
		SHA256: digest, UpdatedAt: updatedAt,
	}

	recorder := httptest.NewRecorder()
	setFileHeaders(recorder, file, true, 1024)

	headers := recorder.Header()
	if got := headers.Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("Accept-Ranges = %q, want bytes", got)
	}
	if got := headers.Get("Content-Length"); got != "1024" {
		t.Fatalf("Content-Length = %q, want 1024", got)
	}
	if got := headers.Get("Last-Modified"); got != updatedAt.Format(http.TimeFormat) {
		t.Fatalf("Last-Modified = %q", got)
	}
	if got := headers.Get("ETag"); got == "" {
		t.Fatal("ETag is empty")
	}
	if got := headers.Get("Cache-Control"); got != "no-store, no-transform" {
		t.Fatalf("Cache-Control = %q, want no-store, no-transform", got)
	}
	if got := headers.Get("Content-Disposition"); !strings.HasPrefix(got, "attachment") {
		t.Fatalf("Content-Disposition = %q, want attachment", got)
	}
}

func TestSetFileHeadersForPreview(t *testing.T) {
	file := files.File{Name: "image.jpg", MIMEType: "image/jpeg"}

	recorder := httptest.NewRecorder()
	setFileHeaders(recorder, file, false, 1024)

	headers := recorder.Header()
	if got := headers.Get("Cache-Control"); got != "private, no-cache, no-transform" {
		t.Fatalf("Cache-Control = %q, want private, no-cache, no-transform", got)
	}
	if got := headers.Get("Content-Disposition"); !strings.HasPrefix(got, "inline") {
		t.Fatalf("Content-Disposition = %q, want inline", got)
	}
}

func TestFileNotModified(t *testing.T) {
	digest := make([]byte, 32)
	for i := range digest {
		digest[i] = byte(i + 1)
	}
	updatedAt := time.Date(2026, time.August, 20, 1, 2, 3, 500_000_000, time.UTC)
	file := files.File{SHA256: digest, UpdatedAt: updatedAt}
	etag := fileETag(file)

	tests := []struct {
		name            string
		ifNoneMatch     string
		ifModifiedSince string
		want            bool
	}{
		{name: "no validators", want: false},
		{name: "matching etag", ifNoneMatch: etag, want: true},
		{name: "matching weak etag", ifNoneMatch: "W/" + etag, want: true},
		{name: "matching etag in list", ifNoneMatch: `"other", W/` + etag, want: true},
		{name: "wildcard", ifNoneMatch: "*", want: true},
		{name: "different etag", ifNoneMatch: `"different"`, want: false},
		{
			name:            "if none match takes precedence",
			ifNoneMatch:     `"different"`,
			ifModifiedSince: updatedAt.Format(http.TimeFormat),
			want:            false,
		},
		{
			name:            "matching modified since",
			ifModifiedSince: updatedAt.Truncate(time.Second).Format(http.TimeFormat),
			want:            true,
		},
		{
			name:            "newer modified since",
			ifModifiedSince: updatedAt.Add(time.Minute).Format(http.TimeFormat),
			want:            true,
		},
		{
			name:            "older modified since",
			ifModifiedSince: updatedAt.Add(-time.Minute).Format(http.TimeFormat),
			want:            false,
		},
		{name: "invalid modified since", ifModifiedSince: "invalid", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/v1/files/test/content", nil)
			if test.ifNoneMatch != "" {
				request.Header.Set("If-None-Match", test.ifNoneMatch)
			}
			if test.ifModifiedSince != "" {
				request.Header.Set("If-Modified-Since", test.ifModifiedSince)
			}

			if got := fileNotModified(request, file); got != test.want {
				t.Fatalf("fileNotModified() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestIfRangeMatches(t *testing.T) {
	digest := make([]byte, 32)
	for i := range digest {
		digest[i] = byte(i + 1)
	}
	updatedAt := time.Date(2026, time.August, 20, 1, 2, 3, 500_000_000, time.UTC)
	file := files.File{SHA256: digest, UpdatedAt: updatedAt}
	etag := fileETag(file)

	tests := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "empty", value: "", want: true},
		{name: "matching etag", value: etag, want: true},
		{name: "different etag", value: `"different"`, want: false},
		{name: "weak etag", value: `W/` + etag, want: false},
		{name: "matching date", value: updatedAt.Truncate(time.Second).Format(http.TimeFormat), want: true},
		{name: "newer date", value: updatedAt.Add(time.Minute).Format(http.TimeFormat), want: true},
		{name: "older date", value: updatedAt.Add(-time.Minute).Format(http.TimeFormat), want: false},
		{name: "invalid", value: "not-a-validator", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ifRangeMatches(test.value, file); got != test.want {
				t.Fatalf("ifRangeMatches(%q) = %v, want %v", test.value, got, test.want)
			}
		})
	}
}
