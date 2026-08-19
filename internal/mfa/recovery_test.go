package mfa

import "testing"

func TestGenerateRecoveryCodes(t *testing.T) {
	codes, hashes, err := generateRecoveryCodes(recoveryCodeCount)
	if err != nil {
		t.Fatalf("generateRecoveryCodes() error: %v", err)
	}

	if len(codes) != recoveryCodeCount || len(hashes) != recoveryCodeCount {
		t.Fatalf("codes=%d hashes=%d", len(codes), len(hashes))
	}

	seen := make(map[string]bool)
	for i, code := range codes {
		if code == "" {
			t.Fatal("empty recovery code")
		}
		if seen[code] {
			t.Fatalf("duplicate recovery code %q", code)
		}
		seen[code] = true

		hash := HashRecoveryCode(code)
		if string(hash[:]) != string(hashes[i]) {
			t.Fatalf("hash mismatch for code %d", i)
		}
	}
}

func TestRecoveryCodeNormalization(t *testing.T) {
	a := HashRecoveryCode("ABCDE-12345-ABCDE-12345")
	b := HashRecoveryCode("abcde12345abcde12345")

	if a != b {
		t.Fatal("equivalent recovery codes produced different hashes")
	}
}
