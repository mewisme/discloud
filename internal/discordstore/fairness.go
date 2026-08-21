package discordstore

import (
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

var fairLeaseOperations = [...]blobstore.LeaseOperation{
	blobstore.LeaseOperationUpload,
	blobstore.LeaseOperationResolve,
	blobstore.LeaseOperationDelete,
	blobstore.LeaseOperationMaintenance,
	blobstore.LeaseOperationUnknown,
}

type schedulerBotSelection struct {
	bot              Bot
	index            int
	eligible         int
	busyEligible     bool
	available        bool
	earliestCooldown time.Time
}

func (s *Scheduler) selectAvailableBotLocked(
	excluded map[string]struct{},
	now time.Time,
) schedulerBotSelection {
	var selection schedulerBotSelection

	for i := 0; i < len(s.bots); i++ {
		index := (s.next + i) % len(s.bots)
		bot := s.bots[index]

		if _, skip := excluded[bot.UserID]; skip {
			continue
		}
		if !s.controlEligibleLocked(bot.UserID) {
			continue
		}

		selection.eligible++

		if s.busy[bot.UserID] {
			selection.busyEligible = true
			continue
		}

		if cooling, until := s.cooldownStateLocked(bot.UserID, now); cooling {
			if selection.earliestCooldown.IsZero() || until.Before(selection.earliestCooldown) {
				selection.earliestCooldown = until
			}
			continue
		}

		if !selection.available {
			selection.bot = bot
			selection.index = index
			selection.available = true
		}
	}

	return selection
}

func (s *Scheduler) enqueueAcquireWaiterLocked(
	operation blobstore.LeaseOperation,
	excluded map[string]struct{},
) uint64 {
	waiterID := s.enqueueLocked(operation)
	s.waiterExclusions[waiterID] = cloneIDSet(excluded)
	s.notifyLocked()
	return waiterID
}

func (s *Scheduler) dequeueAcquireWaiterLocked(
	operation blobstore.LeaseOperation,
	waiterID uint64,
) bool {
	if waiterID == 0 {
		return false
	}

	_, existed := s.waiterExclusions[waiterID]
	delete(s.waiterExclusions, waiterID)
	s.dequeueLocked(operation, waiterID)
	return existed
}

func (s *Scheduler) fairnessAllowsLocked(
	operation blobstore.LeaseOperation,
	waiterID uint64,
	now time.Time,
) bool {
	if waiterID == 0 {
		return !s.hasFairWaitersLocked()
	}
	if _, fair := fairOperationIndex(operation); !fair {
		return true
	}

	nextOperation, nextWaiterID, ok := s.nextAssignableFairWaiterLocked(now)
	return ok && nextOperation == operation && nextWaiterID == waiterID
}

func (s *Scheduler) nextAssignableFairWaiterLocked(
	now time.Time,
) (blobstore.LeaseOperation, uint64, bool) {
	for offset := 0; offset < len(fairLeaseOperations); offset++ {
		index := (s.fairCursor + offset) % len(fairLeaseOperations)
		operation := fairLeaseOperations[index]
		waiterID := s.oldestAssignableWaiterLocked(operation, now)
		if waiterID != 0 {
			return operation, waiterID, true
		}
	}

	return "", 0, false
}

func (s *Scheduler) oldestAssignableWaiterLocked(
	operation blobstore.LeaseOperation,
	now time.Time,
) uint64 {
	waiters := s.waiters[operation]
	var selected uint64

	for waiterID := range waiters {
		if selected != 0 && waiterID >= selected {
			continue
		}
		if !s.waiterCanUseAvailableBotLocked(waiterID, now) {
			continue
		}

		selected = waiterID
	}

	return selected
}

func (s *Scheduler) waiterCanUseAvailableBotLocked(
	waiterID uint64,
	now time.Time,
) bool {
	excluded := s.waiterExclusions[waiterID]

	for _, bot := range s.bots {
		if _, skip := excluded[bot.UserID]; skip {
			continue
		}
		if !s.controlEligibleLocked(bot.UserID) || s.busy[bot.UserID] {
			continue
		}
		if cooling, _ := s.cooldownStateLocked(bot.UserID, now); cooling {
			continue
		}

		return true
	}

	return false
}

func (s *Scheduler) hasFairWaitersLocked() bool {
	for _, operation := range fairLeaseOperations {
		if len(s.waiters[operation]) > 0 {
			return true
		}
	}
	return false
}

func (s *Scheduler) advanceFairnessLocked(operation blobstore.LeaseOperation) {
	index, ok := fairOperationIndex(operation)
	if !ok {
		return
	}

	s.fairCursor = (index + 1) % len(fairLeaseOperations)
}

func fairOperationIndex(operation blobstore.LeaseOperation) (int, bool) {
	operation = normalizeOperation(operation)

	for index, current := range fairLeaseOperations {
		if current == operation {
			return index, true
		}
	}

	return 0, false
}

func cloneIDSet(values map[string]struct{}) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for value := range values {
		result[value] = struct{}{}
	}
	return result
}
