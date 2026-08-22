package auth

import (
	"errors"
	"testing"
)

func TestValidatePassword(t *testing.T) {
	if err := ValidatePassword("short"); !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("ValidatePassword(short) = %v, want ErrWeakPassword", err)
	}
	if err := ValidatePassword("123456789012"); err != nil {
		t.Fatalf("ValidatePassword(valid) = %v", err)
	}
}

func TestValidateTemporaryPassword(t *testing.T) {
	if err := ValidateTemporaryPassword("12345"); !errors.Is(err, ErrInvalidTemporaryPassword) {
		t.Fatalf("ValidateTemporaryPassword(short) = %v, want ErrInvalidTemporaryPassword", err)
	}
	if err := ValidateTemporaryPassword("123456"); err != nil {
		t.Fatalf("ValidateTemporaryPassword(valid) = %v", err)
	}
	if err := ValidateTemporaryPassword("áéíóúý"); err != nil {
		t.Fatalf("ValidateTemporaryPassword(unicode) = %v", err)
	}
}

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
