package discordstore

import (
	"context"
	"sync"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

type Scheduler struct {
	mu               sync.Mutex
	bots             []Bot
	next             int
	cooldown         map[string]time.Time
	busy             map[string]bool
	controls         map[string]*botControl
	leases           map[string]leaseRuntime
	metrics          map[string]*botRuntimeMetrics
	waiters          map[blobstore.LeaseOperation]map[uint64]time.Time
	nextWaiterID     uint64
	events           []RuntimeEvent
	eventSequence    uint64
	subscribers      map[uint64]chan RuntimeEvent
	nextSubscriberID uint64
	changed          chan struct{}
	now              func() time.Time
}

type SchedulerCapacity struct {
	Configured int
	Effective  int
	Available  int
}

func NewScheduler(bots []Bot) *Scheduler {
	return newSchedulerWithClock(bots, time.Now)
}

func newSchedulerWithClock(bots []Bot, now func() time.Time) *Scheduler {
	scheduler := &Scheduler{
		bots:        append([]Bot(nil), bots...),
		cooldown:    make(map[string]time.Time),
		busy:        make(map[string]bool),
		controls:    make(map[string]*botControl),
		leases:      make(map[string]leaseRuntime),
		metrics:     make(map[string]*botRuntimeMetrics),
		waiters:     make(map[blobstore.LeaseOperation]map[uint64]time.Time),
		events:      make([]RuntimeEvent, 0, runtimeEventBufferSize),
		subscribers: make(map[uint64]chan RuntimeEvent),
		changed:     make(chan struct{}),
		now:         now,
	}

	for _, bot := range scheduler.bots {
		scheduler.controls[bot.UserID] = &botControl{
			enabled: true,
			healthy: true,
		}
	}

	return scheduler
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
		if !s.controlEligibleLocked(bot.UserID) {
			continue
		}
		if cooling, _ := s.cooldownStateLocked(bot.UserID, now); cooling {
			continue
		}

		s.next = (index + 1) % len(s.bots)
		return bot, nil
	}

	return Bot{}, blobstore.ErrNoUsableBot
}

func (s *Scheduler) Acquire(
	ctx context.Context,
	excludedBotUserIDs []string,
	metadata ...blobstore.LeaseMetadata,
) (Bot, func(), error) {
	excluded := idSet(excludedBotUserIDs)
	leaseMetadata := blobstore.LeaseMetadata{Operation: blobstore.LeaseOperationUnknown}
	if len(metadata) > 0 {
		leaseMetadata = normalizeLeaseMetadata(metadata[0])
	}

	var waiterID uint64

	for {
		s.mu.Lock()

		if len(s.bots) == 0 {
			s.dequeueLocked(leaseMetadata.Operation, waiterID)
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
			if !s.controlEligibleLocked(bot.UserID) {
				continue
			}

			eligible++

			if s.busy[bot.UserID] {
				busyEligible = true
				continue
			}

			if cooling, until := s.cooldownStateLocked(bot.UserID, now); cooling {
				if earliestCooldown.IsZero() || until.Before(earliestCooldown) {
					earliestCooldown = until
				}
				continue
			}

			s.dequeueLocked(leaseMetadata.Operation, waiterID)
			waiterID = 0
			s.next = (index + 1) % len(s.bots)

			release := s.startLeaseLocked(bot, leaseMetadata, now)
			s.mu.Unlock()
			return bot, release, nil
		}

		if eligible == 0 || !busyEligible {
			s.dequeueLocked(leaseMetadata.Operation, waiterID)
			s.mu.Unlock()
			return Bot{}, nil, blobstore.ErrNoUsableBot
		}

		if waiterID == 0 {
			waiterID = s.enqueueLocked(leaseMetadata.Operation)
		}

		changed := s.changed
		var wait time.Duration
		if !earliestCooldown.IsZero() {
			wait = earliestCooldown.Sub(now)
		}
		s.mu.Unlock()

		if err := waitForScheduler(ctx, changed, wait); err != nil {
			s.mu.Lock()
			s.dequeueLocked(leaseMetadata.Operation, waiterID)
			s.mu.Unlock()
			return Bot{}, nil, err
		}
	}
}

func (s *Scheduler) Get(userID string) (Bot, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.findBotLocked(userID)
}

func (s *Scheduler) Cooldown(userID string, duration time.Duration) {
	if duration <= 0 {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	until := s.now().Add(duration)
	if current, exists := s.cooldown[userID]; exists && !until.After(current) {
		return
	}

	s.cooldown[userID] = until
	s.emitLocked(RuntimeEvent{
		Type:          RuntimeEventCooldownStarted,
		BotUserID:     userID,
		CooldownUntil: timePointer(until),
	})
	s.notifyLocked()
}

func (s *Scheduler) Capacity() SchedulerCapacity {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.controlledCapacityLocked(s.now())
}

func (s *Scheduler) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.bots)
}

func (s *Scheduler) startLeaseLocked(
	bot Bot,
	metadata blobstore.LeaseMetadata,
	startedAt time.Time,
) func() {
	s.busy[bot.UserID] = true
	s.leases[bot.UserID] = leaseRuntime{
		metadata:  cloneLeaseMetadata(metadata),
		startedAt: startedAt,
	}

	s.emitLocked(runtimeEventFromMetadata(
		RuntimeEventLeaseStarted,
		bot.UserID,
		metadata,
	))

	var once sync.Once

	return func() {
		once.Do(func() {
			s.mu.Lock()

			lease, hasLease := s.leases[bot.UserID]
			delete(s.leases, bot.UserID)
			delete(s.busy, bot.UserID)

			if hasLease {
				event := runtimeEventFromMetadata(
					RuntimeEventLeaseFinished,
					bot.UserID,
					lease.metadata,
				)
				event.Duration = s.now().Sub(lease.startedAt)
				s.emitLocked(event)
			}

			s.completeDrainLocked(bot.UserID)
			s.notifyLocked()
			s.mu.Unlock()
		})
	}
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
