package files

import (
	"errors"
	"testing"
)

func FuzzParseRange(f *testing.F) {
	seeds := []struct {
		header string
		size   int64
	}{
		{"", 10},
		{"bytes=0-0", 1},
		{"bytes=0-9", 10},
		{"bytes=5-", 10},
		{"bytes=-5", 10},
		{"bytes=10-20", 10},
		{"bytes=0-1,3-4", 10},
		{"items=0-1", 10},
		{"bytes=0-0", 0},
		{"bytes=0-0", -1},
	}

	for _, seed := range seeds {
		f.Add(seed.header, seed.size)
	}

	f.Fuzz(func(t *testing.T, header string, size int64) {
		value, err := ParseRange(header, size)
		if err != nil {
			if value != nil {
				t.Fatalf("ParseRange(%q, %d) returned value %+v with error %v", header, size, value, err)
			}
			if !errors.Is(err, ErrInvalidRange) && !errors.Is(err, ErrUnsatisfiableRange) {
				t.Fatalf("ParseRange(%q, %d) returned unexpected error %v", header, size, err)
			}
			return
		}

		if value == nil {
			return
		}
		if size <= 0 {
			t.Fatalf("ParseRange(%q, %d) returned %+v for non-positive size", header, size, value)
		}
		if value.Start < 0 {
			t.Fatalf("range start = %d", value.Start)
		}
		if value.End < value.Start {
			t.Fatalf("range = %d-%d", value.Start, value.End)
		}
		if value.End >= size {
			t.Fatalf("range end = %d, size = %d", value.End, size)
		}

		length := value.Length()
		if length <= 0 || length > size {
			t.Fatalf("range length = %d, size = %d", length, size)
		}
	})
}
