package discordstore

import (
	"context"
	"errors"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

var (
	ErrBotNotFound         = errors.New("Discord bot not found")
	ErrBotIdentityMismatch = errors.New("Discord bot identity mismatch")
)

const (
	BotRuntimeDraining  BotRuntimeState = "draining"
	BotRuntimeDisabled  BotRuntimeState = "disabled"
	BotRuntimeUnhealthy BotRuntimeState = "unhealthy"

	RuntimeEventBotStateChanged    RuntimeEventType = "bot.state.changed"
	RuntimeEventBotIdentityUpdated RuntimeEventType = "bot.identity.updated"
)

type botControl struct {
	enabled  bool
	healthy  bool
	draining bool
}

func (s *Scheduler) Drain(userID string) error {
	return s.disableOrDrain(userID)
}

func (s *Scheduler) Disable(userID string) error {
	return s.disableOrDrain(userID)
}

func (s *Scheduler) Enable(userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.findBotLocked(userID); !ok {
		return ErrBotNotFound
	}

	control := s.controlForLocked(userID)
	if control.enabled && !control.draining {
		return nil
	}

	control.enabled = true
	control.draining = false
	s.emitControlStateLocked(userID)
	s.notifyLocked()
	return nil
}

func (s *Scheduler) SetHealthy(userID string, healthy bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.findBotLocked(userID); !ok {
		return ErrBotNotFound
	}

	control := s.controlForLocked(userID)
	if control.healthy == healthy {
		return nil
	}

	control.healthy = healthy
	s.emitControlStateLocked(userID)
	s.notifyLocked()
	return nil
}

func (s *Scheduler) UpdateBotIdentity(
	userID string,
	username string,
	displayName string,
	avatar string,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for index := range s.bots {
		if s.bots[index].UserID != userID {
			continue
		}

		s.bots[index].Username = username
		s.bots[index].DisplayName = displayName
		s.bots[index].Avatar = avatar
		s.emitLocked(RuntimeEvent{
			Type:      RuntimeEventBotIdentityUpdated,
			BotUserID: userID,
		})
		return nil
	}

	return ErrBotNotFound
}

func (s *Scheduler) AcquireControl(
	ctx context.Context,
	userID string,
	metadata blobstore.LeaseMetadata,
) (Bot, func(), error) {
	metadata = normalizeLeaseMetadata(metadata)
	var waiterID uint64

	for {
		s.mu.Lock()

		bot, ok := s.findBotLocked(userID)
		if !ok {
			s.dequeueLocked(metadata.Operation, waiterID)
			s.mu.Unlock()
			return Bot{}, nil, ErrBotNotFound
		}

		if s.busy[userID] {
			if waiterID == 0 {
				waiterID = s.enqueueLocked(metadata.Operation)
			}

			changed := s.changed
			s.mu.Unlock()

			if err := waitForScheduler(ctx, changed, 0); err != nil {
				s.mu.Lock()
				s.dequeueLocked(metadata.Operation, waiterID)
				s.mu.Unlock()
				return Bot{}, nil, err
			}
			continue
		}

		if cooling, _ := s.cooldownStateLocked(userID, s.now()); cooling {
			s.dequeueLocked(metadata.Operation, waiterID)
			s.mu.Unlock()
			return Bot{}, nil, blobstore.ErrNoUsableBot
		}

		s.dequeueLocked(metadata.Operation, waiterID)
		release := s.startLeaseLocked(bot, metadata, s.now())
		s.mu.Unlock()
		return bot, release, nil
	}
}

func (s *Scheduler) ControlledSnapshot() SchedulerRuntimeSnapshot {
	snapshot := s.Snapshot()

	s.mu.Lock()
	defer s.mu.Unlock()

	snapshot.Capacity.Effective = 0
	snapshot.Capacity.Available = 0
	snapshot.Idle = 0
	snapshot.Cooldown = 0

	for index := range snapshot.Bots {
		bot := &snapshot.Bots[index]
		control := s.controlForLocked(bot.UserID)

		switch {
		case control.draining:
			bot.State = BotRuntimeDraining
		case !control.enabled:
			bot.State = BotRuntimeDisabled
		case !control.healthy:
			bot.State = BotRuntimeUnhealthy
		}

		switch bot.State {
		case BotRuntimeIdle:
			snapshot.Idle++
			snapshot.Capacity.Effective++
			snapshot.Capacity.Available++
		case BotRuntimeWorking:
			snapshot.Capacity.Effective++
		case BotRuntimeCooldown:
			snapshot.Cooldown++
		}
	}

	return snapshot
}

func (s *Scheduler) controlledCapacityLocked(now time.Time) SchedulerCapacity {
	capacity := SchedulerCapacity{Configured: len(s.bots)}

	for _, bot := range s.bots {
		if !s.controlEligibleLocked(bot.UserID) {
			continue
		}
		if cooling, _ := s.cooldownStateLocked(bot.UserID, now); cooling {
			continue
		}

		capacity.Effective++
		if !s.busy[bot.UserID] {
			capacity.Available++
		}
	}

	return capacity
}

func (s *Scheduler) controlEligibleLocked(userID string) bool {
	control := s.controlForLocked(userID)
	return control.enabled && control.healthy && !control.draining
}

func (s *Scheduler) completeDrainLocked(userID string) {
	control := s.controlForLocked(userID)
	if !control.draining {
		return
	}

	control.draining = false
	control.enabled = false
	s.emitControlStateLocked(userID)
}

func (s *Scheduler) disableOrDrain(userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.findBotLocked(userID); !ok {
		return ErrBotNotFound
	}

	control := s.controlForLocked(userID)

	if s.busy[userID] {
		if control.draining {
			return nil
		}

		control.draining = true
		s.emitControlStateLocked(userID)
		s.notifyLocked()
		return nil
	}

	if !control.enabled && !control.draining {
		return nil
	}

	control.enabled = false
	control.draining = false
	s.emitControlStateLocked(userID)
	s.notifyLocked()
	return nil
}

func (s *Scheduler) controlForLocked(userID string) *botControl {
	control := s.controls[userID]
	if control != nil {
		return control
	}

	control = &botControl{
		enabled: true,
		healthy: true,
	}
	s.controls[userID] = control
	return control
}

func (s *Scheduler) findBotLocked(userID string) (Bot, bool) {
	for _, bot := range s.bots {
		if bot.UserID == userID {
			return bot, true
		}
	}
	return Bot{}, false
}

func (s *Scheduler) emitControlStateLocked(userID string) {
	s.emitLocked(RuntimeEvent{
		Type:      RuntimeEventBotStateChanged,
		BotUserID: userID,
	})
}
