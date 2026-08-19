package folders

import (
	"errors"
	"fmt"
	"path"
	"strings"
)

var ErrInvalidArchivePath = errors.New("invalid archive path")

func sanitizeArchiveSegment(name string) (string, error) {
	if name == "" || name == "." || name == ".." || strings.ContainsRune(name, 0) {
		return "", ErrInvalidArchivePath
	}

	name = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r < 0x20 || r == 0x7f {
			return '_'
		}
		return r
	}, name)

	if name == "" || name == "." || name == ".." {
		return "", ErrInvalidArchivePath
	}
	return name, nil
}

func uniqueArchiveSegment(used map[string]struct{}, name string, file bool) string {
	for n := 1; ; n++ {
		candidate := name
		if n > 1 {
			candidate = archiveSuffix(name, n, file)
		}

		key := strings.ToLower(candidate)
		if _, exists := used[key]; !exists {
			used[key] = struct{}{}
			return candidate
		}
	}
}

func archiveSuffix(name string, n int, file bool) string {
	if file {
		ext := path.Ext(name)
		if ext != "" && len(ext) < len(name) {
			return strings.TrimSuffix(name, ext) + fmt.Sprintf(" (%d)", n) + ext
		}
	}
	return fmt.Sprintf("%s (%d)", name, n)
}
