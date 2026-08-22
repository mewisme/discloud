package httpapi

import (
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/mewisme/discloud/internal/uploads"
)

func TestParseSHA256(t *testing.T) {
	raw := make([]byte, 32)
	for i := range raw {
		raw[i] = byte(i)
	}

	got, err := parseSHA256(hex.EncodeToString(raw))
	if err != nil {
		t.Fatalf("parseSHA256(): %v", err)
	}
	for i := range got {
		if got[i] != raw[i] {
			t.Fatalf("byte %d = %d, want %d", i, got[i], raw[i])
		}
	}
}

func TestParseSHA256RejectsInvalidValues(t *testing.T) {
	for _, value := range []string{"", "abc", string(make([]byte, 64)), "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"} {
		if _, err := parseSHA256(value); err == nil {
			t.Fatalf("parseSHA256(%q) accepted invalid value", value)
		}
	}
}

func TestOptionalSHA256(t *testing.T) {
	if value, err := optionalSHA256(nil); err != nil || value != nil {
		t.Fatalf("optionalSHA256(nil) = %x, %v", value, err)
	}
}

func TestUploadSessionJSONIncludesRecommendedPartConcurrency(t *testing.T) {
	response := uploadSessionJSON(uploads.Session{}, nil, 8)
	if response.RecommendedPartConcurrency != 8 {
		t.Fatalf(
			"RecommendedPartConcurrency = %d, want 8",
			response.RecommendedPartConcurrency,
		)
	}
}

func TestUploadSessionJSONClampsRecommendedPartConcurrency(t *testing.T) {
	response := uploadSessionJSON(uploads.Session{}, nil, 0)
	if response.RecommendedPartConcurrency != 1 {
		t.Fatalf(
			"RecommendedPartConcurrency = %d, want 1",
			response.RecommendedPartConcurrency,
		)
	}
}

func TestUploadPartJSONDoesNotExposeDeduplicationState(t *testing.T) {
	data, err := json.Marshal(uploadPartJSON(uploads.Part{}))
	if err != nil {
		t.Fatalf("marshal upload part: %v", err)
	}

	if strings.Contains(string(data), "deduplicated") {
		t.Fatalf("upload part response leaks deduplication state: %s", data)
	}
}
