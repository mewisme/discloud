package httpapi

import "testing"

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
