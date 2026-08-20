package auth

import (
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/alexedwards/argon2id"
)

var (
	ErrInvalidUsername          = errors.New("username is required")
	ErrWeakPassword             = errors.New("password must be at least 12 characters")
	ErrInvalidTemporaryPassword = errors.New("temporary password is required")
)

var passwordParams = argon2id.Params{
	Memory:      64 * 1024,
	Iterations:  3,
	Parallelism: 4,
	SaltLength:  16,
	KeyLength:   32,
}

func NormalizeUsername(username string) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", ErrInvalidUsername
	}
	return username, nil
}

func ValidatePassword(password string) error {
	if utf8.RuneCountInString(password) < 12 {
		return ErrWeakPassword
	}
	return nil
}

func ValidateTemporaryPassword(password string) error {
	if utf8.RuneCountInString(password) < 1 {
		return ErrInvalidTemporaryPassword
	}
	return nil
}

func HashPassword(password string) (string, error) {
	return argon2id.CreateHash(password, &passwordParams)
}

func VerifyPassword(password, hash string) (bool, error) {
	return argon2id.ComparePasswordAndHash(password, hash)
}
