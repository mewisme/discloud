package files

import (
	"errors"
	"testing"
)

func TestParseRange(t *testing.T) {
	tests := []struct {
		header string
		size   int64
		want   *ByteRange
	}{
		{"", 10, nil},
		{"bytes=0-4", 10, &ByteRange{0, 4}},
		{"bytes=5-", 10, &ByteRange{5, 9}},
		{"bytes=-4", 10, &ByteRange{6, 9}},
		{"bytes=0-99", 10, &ByteRange{0, 9}},
		{"bytes=-99", 10, &ByteRange{0, 9}},
	}

	for _, tt := range tests {
		got, err := ParseRange(tt.header, tt.size)
		if err != nil {
			t.Fatalf("ParseRange(%q): %v", tt.header, err)
		}
		if got == nil && tt.want == nil {
			continue
		}
		if got == nil || tt.want == nil || *got != *tt.want {
			t.Fatalf("ParseRange(%q) = %+v, want %+v", tt.header, got, tt.want)
		}
	}
}

func TestParseRangeRejectsInvalid(t *testing.T) {
	for _, header := range []string{
		"bytes",
		"items=0-1",
		"bytes=1",
		"bytes=a-b",
		"bytes=5-4",
		"bytes=-0",
		"bytes=0-1,3-4",
	} {
		if _, err := ParseRange(header, 10); !errors.Is(err, ErrInvalidRange) {
			t.Fatalf("ParseRange(%q) = %v", header, err)
		}
	}
}

func TestParseRangeRejectsUnsatisfiable(t *testing.T) {
	for _, tt := range []struct {
		header string
		size   int64
	}{
		{"bytes=10-", 10},
		{"bytes=0-", 0},
		{"bytes=-1", 0},
	} {
		if _, err := ParseRange(tt.header, tt.size); !errors.Is(err, ErrUnsatisfiableRange) {
			t.Fatalf("ParseRange(%q, %d) = %v", tt.header, tt.size, err)
		}
	}
}
