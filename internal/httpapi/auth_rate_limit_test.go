package httpapi

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAuthRateLimitsNormalizeUsername(t *testing.T) {
	limits := newAuthRateLimits()

	for i := 0; i < loginUsernameLimit; i++ {
		allowed, _ := limits.allowLogin(
			fmt.Sprintf("203.0.113.%d", i+1),
			[]string{"alice", "ALICE", " Alice "}[i%3],
		)
		if !allowed {
			t.Fatalf("attempt %d was rejected early", i+1)
		}
	}

	allowed, retryAfter := limits.allowLogin("198.51.100.1", "aLiCe")
	if allowed {
		t.Fatal("username limiter allowed request beyond burst")
	}
	if retryAfter <= 0 {
		t.Fatalf("retry after = %s", retryAfter)
	}

	limits.resetLoginUsername(" ALICE ")

	if allowed, _ := limits.allowLogin("198.51.100.2", "alice"); !allowed {
		t.Fatal("username limiter was not reset")
	}
}

func TestAuthRateLimitsLimitLoginIP(t *testing.T) {
	limits := newAuthRateLimits()

	for i := 0; i < loginIPLimit; i++ {
		allowed, _ := limits.allowLogin(
			"203.0.113.10",
			fmt.Sprintf("user-%d", i),
		)
		if !allowed {
			t.Fatalf("attempt %d was rejected early", i+1)
		}
	}

	allowed, retryAfter := limits.allowLogin("203.0.113.10", "another-user")
	if allowed {
		t.Fatal("IP limiter allowed request beyond burst")
	}
	if retryAfter <= 0 {
		t.Fatalf("retry after = %s", retryAfter)
	}
}

func TestAuthRateLimitsLimitMFAIP(t *testing.T) {
	limits := newAuthRateLimits()

	for i := 0; i < mfaIPLimit; i++ {
		if allowed, _ := limits.allowMFA("203.0.113.20"); !allowed {
			t.Fatalf("attempt %d was rejected early", i+1)
		}
	}

	if allowed, retryAfter := limits.allowMFA("203.0.113.20"); allowed || retryAfter <= 0 {
		t.Fatalf("limit result = allowed:%v retryAfter:%s", allowed, retryAfter)
	}
}

func TestWriteAuthRateLimit(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	rec := httptest.NewRecorder()

	writeAuthRateLimit(rec, req, 1500*time.Millisecond)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusTooManyRequests)
	}
	if got := rec.Header().Get("Retry-After"); got != "2" {
		t.Fatalf("Retry-After = %q, want %q", got, "2")
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want %q", got, "no-store")
	}
}
