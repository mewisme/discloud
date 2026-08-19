package nodes

import (
	"errors"
	"strings"
	"testing"

	"golang.org/x/text/unicode/norm"
)

func FuzzNormalizeName(f *testing.F) {
	for _, seed := range []string{
		"file.txt",
		" File.txt ",
		"Résumé.pdf",
		"re\u0301sume\u0301.pdf",
		".",
		"..",
		"",
		"a/b",
		`a\b`,
		"\x00",
		"Straße",
	} {
		f.Add(seed)
	}

	f.Fuzz(func(t *testing.T, name string) {
		display, key, err := NormalizeName(name)
		if err != nil {
			if !errors.Is(err, ErrInvalidName) {
				t.Fatalf("NormalizeName(%q): %v", name, err)
			}
			if display != "" || key != "" {
				t.Fatalf("invalid name returned display=%q key=%q", display, key)
			}
			return
		}

		if display == "" || key == "" {
			t.Fatalf("NormalizeName(%q) returned empty values", name)
		}
		if display != strings.TrimSpace(display) {
			t.Fatalf("display name is not trimmed: %q", display)
		}
		if display == "." || display == ".." {
			t.Fatalf("dot name accepted: %q", display)
		}
		if strings.ContainsRune(display, 0) || strings.ContainsAny(display, `/\`) {
			t.Fatalf("unsafe display name accepted: %q", display)
		}
		if !norm.NFC.IsNormalString(display) {
			t.Fatalf("display name is not NFC: %q", display)
		}
		if !norm.NFC.IsNormalString(key) {
			t.Fatalf("name key is not NFC: %q", key)
		}

		secondDisplay, secondKey, err := NormalizeName(display)
		if err != nil {
			t.Fatalf("normalized name rejected on second pass: %v", err)
		}
		if secondDisplay != display || secondKey != key {
			t.Fatalf(
				"NormalizeName is not idempotent: (%q, %q) -> (%q, %q)",
				display,
				key,
				secondDisplay,
				secondKey,
			)
		}
	})
}
