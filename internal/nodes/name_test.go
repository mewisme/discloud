package nodes

import (
	"errors"
	"testing"
)

func TestNormalizeName(t *testing.T) {
	display, key, err := NormalizeName("  Résumé  ")
	if err != nil {
		t.Fatalf("NormalizeName() error: %v", err)
	}

	if display != "Résumé" {
		t.Fatalf("display = %q, want Résumé", display)
	}
	if key != "résumé" {
		t.Fatalf("key = %q, want résumé", key)
	}
}

func TestNormalizeNameCanonicalEquivalent(t *testing.T) {
	_, a, err := NormalizeName("Résumé")
	if err != nil {
		t.Fatal(err)
	}

	_, b, err := NormalizeName("Re\u0301sume\u0301")
	if err != nil {
		t.Fatal(err)
	}

	if a != b {
		t.Fatalf("keys differ: %q != %q", a, b)
	}
}

func TestNormalizeNameRejectsInvalidNames(t *testing.T) {
	for _, name := range []string{
		"",
		"   ",
		".",
		"..",
		"a/b",
		`a\b`,
		"a\x00b",
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := NormalizeName(name); !errors.Is(err, ErrInvalidName) {
				t.Fatalf("NormalizeName(%q) = %v", name, err)
			}
		})
	}
}
