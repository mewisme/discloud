package discordstore

import (
	"container/list"
	"strings"
	"sync"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

const (
	defaultCDNURLCacheEntries = 8192
	cdnURLSafetyWindow        = time.Minute
	cdnURLFallbackTTL         = 5 * time.Minute
)

type cdnURLCache struct {
	mu         sync.Mutex
	maxEntries int
	entries    map[blobstore.Location]*list.Element
	order      *list.List
}

type cdnURLCacheEntry struct {
	location   blobstore.Location
	url        string
	expiresAt  time.Time
	validUntil time.Time
}

func newCDNURLCache(maxEntries int) *cdnURLCache {
	if maxEntries < 1 {
		maxEntries = 1
	}
	return &cdnURLCache{
		maxEntries: maxEntries,
		entries:    make(map[blobstore.Location]*list.Element, maxEntries),
		order:      list.New(),
	}
}

func (c *cdnURLCache) Get(location blobstore.Location, now time.Time) (string, time.Time, bool) {
	if c == nil {
		return "", time.Time{}, false
	}

	now = now.UTC()

	c.mu.Lock()
	defer c.mu.Unlock()

	element, ok := c.entries[location]
	if !ok {
		return "", time.Time{}, false
	}

	entry := element.Value.(*cdnURLCacheEntry)
	if !now.Before(entry.validUntil) {
		c.removeElement(element)
		return "", time.Time{}, false
	}

	c.order.MoveToFront(element)
	return entry.url, entry.expiresAt, true
}

func (c *cdnURLCache) Set(location blobstore.Location, rawURL string, expiresAt, now time.Time) {
	if c == nil ||
		location.DiscordChannelID == "" ||
		location.DiscordMessageID == "" ||
		location.DiscordAttachmentID == "" {
		return
	}

	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return
	}

	now = now.UTC()
	expiresAt = expiresAt.UTC()
	validUntil := now.Add(cdnURLFallbackTTL)

	if !expiresAt.IsZero() {
		validUntil = expiresAt.Add(-cdnURLSafetyWindow)
		if !validUntil.After(now) {
			c.Delete(location)
			return
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if element, ok := c.entries[location]; ok {
		entry := element.Value.(*cdnURLCacheEntry)
		entry.url = rawURL
		entry.expiresAt = expiresAt
		entry.validUntil = validUntil
		c.order.MoveToFront(element)
		return
	}

	entry := &cdnURLCacheEntry{
		location:   location,
		url:        rawURL,
		expiresAt:  expiresAt,
		validUntil: validUntil,
	}
	element := c.order.PushFront(entry)
	c.entries[location] = element

	for len(c.entries) > c.maxEntries {
		c.removeElement(c.order.Back())
	}
}

func (c *cdnURLCache) Delete(location blobstore.Location) {
	if c == nil {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if element, ok := c.entries[location]; ok {
		c.removeElement(element)
	}
}

func (c *cdnURLCache) DeleteMessage(channelID, messageID string) {
	if c == nil || channelID == "" || messageID == "" {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	for location, element := range c.entries {
		if location.DiscordChannelID == channelID &&
			location.DiscordMessageID == messageID {
			c.removeElement(element)
		}
	}
}

func (c *cdnURLCache) Len() int {
	if c == nil {
		return 0
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.entries)
}

func (c *cdnURLCache) removeElement(element *list.Element) {
	if element == nil {
		return
	}

	entry := element.Value.(*cdnURLCacheEntry)
	delete(c.entries, entry.location)
	c.order.Remove(element)
}
