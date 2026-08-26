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
	publicShareUnlockWindow     = 5 * time.Minute
	publicShareUnlockIPLimit    = 30
	publicShareUnlockPairLimit  = 8
	publicShareUnlockMaxEntries = 20_000
)

type publicShareUnlockLimits struct {
	ip   *ratelimit.Limiter
	pair *ratelimit.Limiter
}

func newPublicShareUnlockLimits() *publicShareUnlockLimits {
	return &publicShareUnlockLimits{
		ip:   ratelimit.New(publicShareUnlockIPLimit, publicShareUnlockWindow, publicShareUnlockMaxEntries),
		pair: ratelimit.New(publicShareUnlockPairLimit, publicShareUnlockWindow, publicShareUnlockMaxEntries),
	}
}

func (l *publicShareUnlockLimits) allow(ipAddress, publicID string) (bool, time.Duration) {
	ipAllowed, ipRetryAfter := l.ip.Allow(authIPRateLimitKey(ipAddress))
	pairAllowed, pairRetryAfter := l.pair.Allow(publicShareUnlockPairKey(ipAddress, publicID))
	return ipAllowed && pairAllowed, maxDuration(ipRetryAfter, pairRetryAfter)
}

func publicShareUnlockPairKey(ipAddress, publicID string) string {
	value := authIPRateLimitKey(ipAddress) + "\x00" + strings.TrimSpace(publicID)
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func writePublicShareUnlockRateLimit(w http.ResponseWriter, r *http.Request, retryAfter time.Duration) {
	seconds := int((retryAfter + time.Second - 1) / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	WriteProblem(w, r, http.StatusTooManyRequests, "Too Many Requests", "too many public share unlock attempts; try again later")
}
