package auth

import "testing"

func TestPasswordHashAndVerify(t *testing.T) {
	const password = "correct-horse-battery-staple"

	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword() error: %v", err)
	}

	match, err := VerifyPassword(password, hash)
	if err != nil {
		t.Fatalf("VerifyPassword() error: %v", err)
	}
	if !match {
		t.Fatal("password did not match")
	}

	match, err = VerifyPassword("wrong-password", hash)
	if err != nil {
		t.Fatalf("VerifyPassword() wrong password error: %v", err)
	}
	if match {
		t.Fatal("wrong password matched")
	}
}

func TestPasswordHashesUseDifferentSalts(t *testing.T) {
	const password = "correct-horse-battery-staple"

	a, err := HashPassword(password)
	if err != nil {
		t.Fatalf("first hash: %v", err)
	}

	b, err := HashPassword(password)
	if err != nil {
		t.Fatalf("second hash: %v", err)
	}

	if a == b {
		t.Fatal("two password hashes are identical")
	}
}
