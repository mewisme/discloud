package discordstore

import (
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

func TestCDNURLCacheEvictsLeastRecentlyUsed(t *testing.T) {
	cache := newCDNURLCache(2)
	now := time.Date(2026, 8, 22, 10, 0, 0, 0, time.UTC)
	expiresAt := now.Add(time.Hour)

	first := cdnCacheTestLocation("message-1")
	second := cdnCacheTestLocation("message-2")
	third := cdnCacheTestLocation("message-3")

	cache.Set(first, "https://cdn.example/1", expiresAt, now)
	cache.Set(second, "https://cdn.example/2", expiresAt, now)

	if _, _, ok := cache.Get(first, now); !ok {
		t.Fatal("first entry was not cached")
	}

	cache.Set(third, "https://cdn.example/3", expiresAt, now)

	if cache.Len() != 2 {
		t.Fatalf("cache length = %d, want 2", cache.Len())
	}
	if _, _, ok := cache.Get(second, now); ok {
		t.Fatal("least recently used entry was not evicted")
	}
	if _, _, ok := cache.Get(first, now); !ok {
		t.Fatal("recently used entry was evicted")
	}
	if _, _, ok := cache.Get(third, now); !ok {
		t.Fatal("new entry was not cached")
	}
}

func TestCDNURLCacheRespectsExpirySafetyWindow(t *testing.T) {
	cache := newCDNURLCache(2)
	now := time.Date(2026, 8, 22, 10, 0, 0, 0, time.UTC)
	location := cdnCacheTestLocation("message-1")

	cache.Set(
		location,
		"https://cdn.example/near-expiry",
		now.Add(cdnURLSafetyWindow/2),
		now,
	)

	if _, _, ok := cache.Get(location, now); ok {
		t.Fatal("near-expiry URL was cached")
	}

	cache.Set(location, "https://cdn.example/fallback", time.Time{}, now)

	if _, _, ok := cache.Get(location, now.Add(cdnURLFallbackTTL-time.Second)); !ok {
		t.Fatal("URL without explicit expiry expired too early")
	}
	if _, _, ok := cache.Get(location, now.Add(cdnURLFallbackTTL)); ok {
		t.Fatal("URL without explicit expiry outlived fallback TTL")
	}
}

func TestCDNURLCacheDeleteMessage(t *testing.T) {
	cache := newCDNURLCache(4)
	now := time.Date(2026, 8, 22, 10, 0, 0, 0, time.UTC)
	expiresAt := now.Add(time.Hour)

	first := cdnCacheTestLocation("message-1")
	second := first
	second.DiscordAttachmentID = "attachment-2"
	other := cdnCacheTestLocation("message-2")

	cache.Set(first, "https://cdn.example/1", expiresAt, now)
	cache.Set(second, "https://cdn.example/2", expiresAt, now)
	cache.Set(other, "https://cdn.example/3", expiresAt, now)

	cache.DeleteMessage("channel-1", "message-1")

	if _, _, ok := cache.Get(first, now); ok {
		t.Fatal("first message attachment remained cached")
	}
	if _, _, ok := cache.Get(second, now); ok {
		t.Fatal("second message attachment remained cached")
	}
	if _, _, ok := cache.Get(other, now); !ok {
		t.Fatal("unrelated message was evicted")
	}
}

func cdnCacheTestLocation(messageID string) blobstore.Location {
	return blobstore.Location{
		DiscordChannelID:    "channel-1",
		DiscordMessageID:    messageID,
		DiscordAttachmentID: "attachment-1",
	}
}
