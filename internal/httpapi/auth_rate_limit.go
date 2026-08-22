package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mewisme/discloud/internal/ratelimit"
)

const (
	authRateLimitWindow     = 5 * time.Minute
	loginIPLimit            = 30
	loginUsernameLimit      = 8
	mfaIPLimit              = 30
	authRateLimitMaxEntries = 10_000
)

type authRateLimits struct {
	loginIP       *ratelimit.Limiter
	loginUsername *ratelimit.Limiter
	mfaIP         *ratelimit.Limiter
}

func newAuthRateLimits() *authRateLimits {
	return &authRateLimits{
		loginIP:       ratelimit.New(loginIPLimit, authRateLimitWindow, authRateLimitMaxEntries),
		loginUsername: ratelimit.New(loginUsernameLimit, authRateLimitWindow, authRateLimitMaxEntries),
		mfaIP:         ratelimit.New(mfaIPLimit, authRateLimitWindow, authRateLimitMaxEntries),
	}
}

func (l *authRateLimits) allowLogin(ipAddress, username string) (bool, time.Duration) {
	ipAllowed, ipRetryAfter := l.loginIP.Allow(authIPRateLimitKey(ipAddress))
	usernameAllowed, usernameRetryAfter := l.loginUsername.Allow(authUsernameRateLimitKey(username))

	return ipAllowed && usernameAllowed, maxDuration(ipRetryAfter, usernameRetryAfter)
}

func (l *authRateLimits) resetLoginUsername(username string) {
	l.loginUsername.Reset(authUsernameRateLimitKey(username))
}

func (l *authRateLimits) allowMFA(ipAddress string) (bool, time.Duration) {
	return l.mfaIP.Allow(authIPRateLimitKey(ipAddress))
}

func authIPRateLimitKey(ipAddress string) string {
	ipAddress = strings.TrimSpace(ipAddress)
	if ipAddress == "" {
		return "unknown"
	}
	return ipAddress
}

func authUsernameRateLimitKey(username string) string {
	value := strings.ToLower(strings.TrimSpace(username))
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func writeAuthRateLimit(w http.ResponseWriter, r *http.Request, retryAfter time.Duration) {
	seconds := int((retryAfter + time.Second - 1) / time.Second)
	if seconds < 1 {
		seconds = 1
	}

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	WriteProblem(w, r, http.StatusTooManyRequests, "Too Many Requests", "too many authentication attempts; try again later")
}

func maxDuration(a, b time.Duration) time.Duration {
	if a > b {
		return a
	}
	return b
}
