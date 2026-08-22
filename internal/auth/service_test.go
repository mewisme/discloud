package auth

import "testing"

func TestDummyPasswordHash(t *testing.T) {
	match, err := VerifyPassword("definitely-not-the-dummy-password", dummyPasswordHash)
	if err != nil {
		t.Fatalf("VerifyPassword(dummy) error: %v", err)
	}
	if match {
		t.Fatal("dummy password unexpectedly matched")
	}
}
