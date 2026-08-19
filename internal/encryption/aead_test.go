package encryption

import (
	"bytes"
	"testing"
)

func TestSealOpen(t *testing.T) {
	key := bytes.Repeat([]byte{1}, 32)
	plaintext := []byte("totp-secret")

	ciphertext, err := Seal(key, plaintext)
	if err != nil {
		t.Fatalf("Seal() error: %v", err)
	}
	if bytes.Contains(ciphertext, plaintext) {
		t.Fatal("ciphertext contains plaintext")
	}

	got, err := Open(key, ciphertext)
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("Open() = %q, want %q", got, plaintext)
	}
}

func TestOpenRejectsTampering(t *testing.T) {
	key := bytes.Repeat([]byte{1}, 32)

	ciphertext, err := Seal(key, []byte("secret"))
	if err != nil {
		t.Fatalf("Seal() error: %v", err)
	}

	ciphertext[len(ciphertext)-1] ^= 1
	if _, err := Open(key, ciphertext); err == nil {
		t.Fatal("Open() accepted tampered ciphertext")
	}
}
