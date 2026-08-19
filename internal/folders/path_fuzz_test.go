package folders

import (
	"errors"
	"strings"
	"testing"
)

func FuzzSanitizeArchiveSegment(f *testing.F) {
	for _, seed := range []string{
		"file.txt",
		"folder",
		".",
		"..",
		"../secret",
		`..\secret`,
		"a/b",
		`a\b`,
		"\x00",
		"\n",
		"Résumé.pdf",
	} {
		f.Add(seed)
	}

	f.Fuzz(func(t *testing.T, name string) {
		got, err := sanitizeArchiveSegment(name)
		if err != nil {
			if !errors.Is(err, ErrInvalidArchivePath) {
				t.Fatalf("sanitizeArchiveSegment(%q): %v", name, err)
			}
			return
		}

		if got == "" || got == "." || got == ".." {
			t.Fatalf("unsafe archive segment %q from %q", got, name)
		}
		if strings.ContainsRune(got, 0) {
			t.Fatalf("archive segment contains NUL: %q", got)
		}

		for _, r := range got {
			if r == '/' || r == '\\' {
				t.Fatalf("archive segment contains path separator: %q", got)
			}
			if r < 0x20 || r == 0x7f {
				t.Fatalf("archive segment contains control character U+%04X: %q", r, got)
			}
		}
	})
}
