package mfa

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

const recoveryCodeCount = 10

func generateRecoveryCodes(count int) ([]string, [][]byte, error) {
	codes := make([]string, count)
	hashes := make([][]byte, count)

	for i := range count {
		var raw [10]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return nil, nil, fmt.Errorf("generate recovery code: %w", err)
		}

		value := hex.EncodeToString(raw[:])
		codes[i] = value[:5] + "-" + value[5:10] + "-" + value[10:15] + "-" + value[15:]

		hash := HashRecoveryCode(codes[i])
		hashes[i] = hash[:]
	}

	return codes, hashes, nil
}

func HashRecoveryCode(code string) [32]byte {
	code = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
	return sha256.Sum256([]byte(code))
}
