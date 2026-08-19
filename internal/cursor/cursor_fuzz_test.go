package cursor

import (
	"errors"
	"slices"
	"testing"
)

func FuzzDecode(f *testing.F) {
	f.Add(Encode("one"), 1)
	f.Add(Encode("one", "two"), 2)
	f.Add("", 1)
	f.Add("not-base64", 1)
	f.Add(Encode("one"), 2)
	f.Add(Encode("one"), 0)
	f.Add("W10", 1)

	f.Fuzz(func(t *testing.T, value string, count int) {
		parts, err := Decode(value, count)
		if err != nil {
			if !errors.Is(err, ErrInvalid) {
				t.Fatalf("Decode(%q, %d): %v", value, count, err)
			}
			return
		}

		if count < 1 {
			t.Fatalf("Decode succeeded with invalid count %d", count)
		}
		if len(parts) != count {
			t.Fatalf("Decode returned %d parts, want %d", len(parts), count)
		}

		encoded := Encode(parts...)
		roundTrip, err := Decode(encoded, count)
		if err != nil {
			t.Fatalf("round-trip Decode(%q, %d): %v", encoded, count, err)
		}
		if !slices.Equal(roundTrip, parts) {
			t.Fatalf(
				"cursor round-trip = %#v, want %#v",
				roundTrip,
				parts,
			)
		}
	})
}
