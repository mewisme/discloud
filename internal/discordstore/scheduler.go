package discordstore

import (
	"sync"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

type Scheduler struct {
	mu       sync.Mutex
	bots     []Bot
	next     int
	cooldown map[string]time.Time
	now      func() time.Time
}

func NewScheduler(bots []Bot) *Scheduler {
	return newSchedulerWithClock(bots, time.Now)
}

func newSchedulerWithClock(bots []Bot, now func() time.Time) *Scheduler {
	copied := append([]Bot(nil), bots...)

	return &Scheduler{
		bots:     copied,
		cooldown: make(map[string]time.Time),
		now:      now,
	}
}

func (s *Scheduler) Next(excludedBotUserIDs []string) (Bot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.bots) == 0 {
		return Bot{}, blobstore.ErrNoUsableBot
	}

	excluded := make(map[string]struct{}, len(excludedBotUserIDs))
	for _, userID := range excludedBotUserIDs {
		excluded[userID] = struct{}{}
	}

	now := s.now()

	for i := 0; i < len(s.bots); i++ {
		index := (s.next + i) % len(s.bots)
		bot := s.bots[index]

		if _, skip := excluded[bot.UserID]; skip {
			continue
		}

		if until, cooling := s.cooldown[bot.UserID]; cooling {
			if now.Before(until) {
				continue
			}
			delete(s.cooldown, bot.UserID)
		}

		s.next = (index + 1) % len(s.bots)
		return bot, nil
	}

	return Bot{}, blobstore.ErrNoUsableBot
}

func (s *Scheduler) Cooldown(userID string, duration time.Duration) {
	if duration <= 0 {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	until := s.now().Add(duration)
	if current, exists := s.cooldown[userID]; !exists || until.After(current) {
		s.cooldown[userID] = until
	}
}

func (s *Scheduler) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()

	return len(s.bots)
}
