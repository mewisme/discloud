package discordstore

import (
	"context"
	"sync"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

type Scheduler struct {
	mu       sync.Mutex
	bots     []Bot
	next     int
	cooldown map[string]time.Time
	busy     map[string]bool
	changed  chan struct{}
	now      func() time.Time
}

func NewScheduler(bots []Bot) *Scheduler {
	return newSchedulerWithClock(bots, time.Now)
}

func newSchedulerWithClock(bots []Bot, now func() time.Time) *Scheduler {
	return &Scheduler{
		bots:     append([]Bot(nil), bots...),
		cooldown: make(map[string]time.Time),
		busy:     make(map[string]bool),
		changed:  make(chan struct{}),
		now:      now,
	}
}

func (s *Scheduler) Next(excludedBotUserIDs []string) (Bot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.bots) == 0 {
		return Bot{}, blobstore.ErrNoUsableBot
	}

	excluded := idSet(excludedBotUserIDs)
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

func (s *Scheduler) Acquire(ctx context.Context, excludedBotUserIDs []string) (Bot, func(), error) {
	excluded := idSet(excludedBotUserIDs)

	for {
		s.mu.Lock()
		if len(s.bots) == 0 {
			s.mu.Unlock()
			return Bot{}, nil, blobstore.ErrNoUsableBot
		}

		now := s.now()
		eligible := 0
		busyEligible := false
		var earliestCooldown time.Time

		for i := 0; i < len(s.bots); i++ {
			index := (s.next + i) % len(s.bots)
			bot := s.bots[index]
			if _, skip := excluded[bot.UserID]; skip {
				continue
			}

			eligible++

			if s.busy[bot.UserID] {
				busyEligible = true
				continue
			}

			if until, cooling := s.cooldown[bot.UserID]; cooling {
				if now.Before(until) {
					if earliestCooldown.IsZero() || until.Before(earliestCooldown) {
						earliestCooldown = until
					}
					continue
				}
				delete(s.cooldown, bot.UserID)
			}

			s.busy[bot.UserID] = true
			s.next = (index + 1) % len(s.bots)

			var once sync.Once
			release := func() {
				once.Do(func() {
					s.mu.Lock()
					delete(s.busy, bot.UserID)
					s.notifyLocked()
					s.mu.Unlock()
				})
			}

			s.mu.Unlock()
			return bot, release, nil
		}

		if eligible == 0 || !busyEligible {
			s.mu.Unlock()
			return Bot{}, nil, blobstore.ErrNoUsableBot
		}

		changed := s.changed
		var wait time.Duration
		if !earliestCooldown.IsZero() {
			wait = earliestCooldown.Sub(now)
		}
		s.mu.Unlock()

		if err := waitForScheduler(ctx, changed, wait); err != nil {
			return Bot{}, nil, err
		}
	}
}

func (s *Scheduler) Get(userID string) (Bot, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, bot := range s.bots {
		if bot.UserID == userID {
			return bot, true
		}
	}
	return Bot{}, false
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
		s.notifyLocked()
	}
}

func (s *Scheduler) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.bots)
}

func (s *Scheduler) notifyLocked() {
	close(s.changed)
	s.changed = make(chan struct{})
}

func idSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func waitForScheduler(ctx context.Context, changed <-chan struct{}, wait time.Duration) error {
	if wait <= 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
			return nil
		}
	}

	timer := time.NewTimer(wait)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-changed:
		return nil
	case <-timer.C:
		return nil
	}
}
