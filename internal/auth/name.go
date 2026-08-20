package auth

import (
	"errors"
	"strings"
	"unicode/utf8"
)

var ErrInvalidName = errors.New("name must be between 1 and 100 characters")

func NormalizeName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if count := utf8.RuneCountInString(value); count < 1 || count > 100 {
		return "", ErrInvalidName
	}
	return value, nil
}
