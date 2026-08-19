package cursor

import (
	"errors"
	"testing"
)

func TestEncodeDecode(t *testing.T) {
	encoded := Encode("folder", "0198aabb-ccdd-7000-8000-000000000001")

	got, err := Decode(encoded, 2)
	if err != nil {
		t.Fatalf("Decode() error: %v", err)
	}

	if got[0] != "folder" || got[1] != "0198aabb-ccdd-7000-8000-000000000001" {
		t.Fatalf("decoded = %#v", got)
	}
}

func TestDecodeRejectsInvalidCursor(t *testing.T) {
	for _, value := range []string{
		"",
		"not-base64!",
		Encode("one"),
	} {
		if _, err := Decode(value, 2); !errors.Is(err, ErrInvalid) {
			t.Fatalf("Decode(%q) = %v", value, err)
		}
	}
}
