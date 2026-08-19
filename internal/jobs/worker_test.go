package jobs

import (
	"errors"
	"testing"
	"time"
)

func TestRetryDelay(t *testing.T) {
	tests := []struct {
		attempt int
		want    time.Duration
	}{
		{0, time.Second},
		{1, time.Second},
		{2, 2 * time.Second},
		{3, 4 * time.Second},
		{6, 32 * time.Second},
		{10, 32 * time.Second},
	}

	for _, test := range tests {
		if got := retryDelay(test.attempt); got != test.want {
			t.Fatalf("retryDelay(%d) = %s, want %s", test.attempt, got, test.want)
		}
	}
}

func TestPermanent(t *testing.T) {
	source := errors.New("invalid payload")
	err := Permanent(source)

	var permanent *PermanentError
	if !errors.As(err, &permanent) {
		t.Fatal("Permanent() did not wrap PermanentError")
	}
	if !errors.Is(err, source) {
		t.Fatal("Permanent() did not preserve source error")
	}
}
