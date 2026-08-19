package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

func newOpaqueToken() (string, [32]byte, error) {
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return "", [32]byte{}, fmt.Errorf("generate token: %w", err)
	}

	token := base64.RawURLEncoding.EncodeToString(secret[:])
	return token, hashOpaqueToken(token), nil
}

func hashOpaqueToken(token string) [32]byte {
	return sha256.Sum256([]byte(token))
}
