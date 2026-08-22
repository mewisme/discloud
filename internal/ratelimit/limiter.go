package ratelimit

import (
	"math"
	"sync"
	"time"
)

type entry struct {
	tokens    float64
	updatedAt time.Time
}

type Limiter struct {
	mu              sync.Mutex
	entries         map[string]entry
	capacity        float64
	refillPerSecond float64
	window          time.Duration
	maxEntries      int
	now             func() time.Time
}

func New(limit int, window time.Duration, maxEntries int) *Limiter {
	return newLimiter(limit, window, maxEntries, time.Now)
}

func newLimiter(limit int, window time.Duration, maxEntries int, now func() time.Time) *Limiter {
	if limit < 1 {
		limit = 1
	}
	if window <= 0 {
		window = time.Minute
	}
	if maxEntries < 1 {
		maxEntries = 1
	}
	if now == nil {
		now = time.Now
	}

	capacity := float64(limit)
	return &Limiter{
		entries:         make(map[string]entry),
		capacity:        capacity,
		refillPerSecond: capacity / window.Seconds(),
		window:          window,
		maxEntries:      maxEntries,
		now:             now,
	}
}

func (l *Limiter) Allow(key string) (bool, time.Duration) {
	now := l.now()

	l.mu.Lock()
	defer l.mu.Unlock()

	item, exists := l.entries[key]
	if !exists {
		l.ensureCapacity(now)
		item = entry{tokens: l.capacity, updatedAt: now}
	}

	if elapsed := now.Sub(item.updatedAt); elapsed > 0 {
		item.tokens += elapsed.Seconds() * l.refillPerSecond
		if item.tokens > l.capacity {
			item.tokens = l.capacity
		}
	}
	item.updatedAt = now

	if item.tokens >= 1 {
		item.tokens--
		l.entries[key] = item
		return true, 0
	}

	l.entries[key] = item
	seconds := (1 - item.tokens) / l.refillPerSecond
	retryAfter := time.Duration(math.Ceil(seconds * float64(time.Second)))
	if retryAfter < time.Nanosecond {
		retryAfter = time.Nanosecond
	}
	return false, retryAfter
}

func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	delete(l.entries, key)
	l.mu.Unlock()
}

func (l *Limiter) ensureCapacity(now time.Time) {
	if len(l.entries) < l.maxEntries {
		return
	}

	for key, item := range l.entries {
		if now.Sub(item.updatedAt) >= l.window {
			delete(l.entries, key)
		}
	}
	if len(l.entries) < l.maxEntries {
		return
	}

	var oldestKey string
	var oldestTime time.Time
	found := false

	for key, item := range l.entries {
		if !found || item.updatedAt.Before(oldestTime) {
			oldestKey = key
			oldestTime = item.updatedAt
			found = true
		}
	}

	if found {
		delete(l.entries, oldestKey)
	}
}
