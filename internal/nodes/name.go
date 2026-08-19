package nodes

import (
	"errors"
	"fmt"
	"strings"

	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

var ErrInvalidName = errors.New("invalid node name")

var nameFolder = cases.Fold()

func NormalizeName(name string) (string, string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", "", fmt.Errorf("%w: name is required", ErrInvalidName)
	}
	if name == "." || name == ".." {
		return "", "", fmt.Errorf("%w: dot names are not allowed", ErrInvalidName)
	}
	if strings.ContainsRune(name, 0) || strings.ContainsAny(name, `/\`) {
		return "", "", fmt.Errorf("%w: path separators are not allowed", ErrInvalidName)
	}

	display := norm.NFC.String(name)
	key := norm.NFC.String(nameFolder.String(display))

	return display, key, nil
}
