package ratelimit

import (
	"testing"
	"time"
)

func TestLimiterAllowsBurstAndRefills(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	limiter := newLimiter(2, 10*time.Second, 10, func() time.Time {
		return now
	})

	if allowed, _ := limiter.Allow("client"); !allowed {
		t.Fatal("first request was rejected")
	}
	if allowed, _ := limiter.Allow("client"); !allowed {
		t.Fatal("second request was rejected")
	}

	allowed, retryAfter := limiter.Allow("client")
	if allowed {
		t.Fatal("request beyond burst was allowed")
	}
	if retryAfter != 5*time.Second {
		t.Fatalf("retry after = %s, want %s", retryAfter, 5*time.Second)
	}

	now = now.Add(5 * time.Second)

	if allowed, _ := limiter.Allow("client"); !allowed {
		t.Fatal("request was not allowed after refill")
	}
}

func TestLimiterReset(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	limiter := newLimiter(1, time.Minute, 10, func() time.Time {
		return now
	})

	if allowed, _ := limiter.Allow("client"); !allowed {
		t.Fatal("first request was rejected")
	}
	if allowed, _ := limiter.Allow("client"); allowed {
		t.Fatal("second request was allowed")
	}

	limiter.Reset("client")

	if allowed, _ := limiter.Allow("client"); !allowed {
		t.Fatal("request was not allowed after reset")
	}
}

func TestLimiterBoundsEntries(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	limiter := newLimiter(1, time.Hour, 2, func() time.Time {
		return now
	})

	limiter.Allow("a")
	now = now.Add(time.Second)
	limiter.Allow("b")
	now = now.Add(time.Second)
	limiter.Allow("c")

	if got := len(limiter.entries); got != 2 {
		t.Fatalf("entry count = %d, want 2", got)
	}
	if _, exists := limiter.entries["a"]; exists {
		t.Fatal("oldest entry was not evicted")
	}
}

func TestLimiterDropsFullyRefilledEntriesBeforeEviction(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	limiter := newLimiter(1, time.Minute, 2, func() time.Time {
		return now
	})

	limiter.Allow("a")
	limiter.Allow("b")

	now = now.Add(time.Minute)
	limiter.Allow("c")

	if got := len(limiter.entries); got != 1 {
		t.Fatalf("entry count = %d, want 1", got)
	}
	if _, exists := limiter.entries["c"]; !exists {
		t.Fatal("new entry is missing")
	}
}
