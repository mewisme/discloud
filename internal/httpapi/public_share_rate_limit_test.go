package httpapi

import "testing"

func TestPublicShareUnlockRateLimitSeparatesShares(t *testing.T) {
	limits := newPublicShareUnlockLimits()
	for i := 0; i < publicShareUnlockPairLimit; i++ {
		if allowed, _ := limits.allow("203.0.113.10", "share-a"); !allowed {
			t.Fatalf("attempt %d unexpectedly rate limited", i+1)
		}
	}
	if allowed, _ := limits.allow("203.0.113.10", "share-a"); allowed {
		t.Fatal("share/ip pair exceeded limit without being rate limited")
	}
	if allowed, _ := limits.allow("203.0.113.10", "share-b"); !allowed {
		t.Fatal("different share unexpectedly shared pair rate limit")
	}
}
