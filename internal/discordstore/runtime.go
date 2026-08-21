package discordstore

import (
	"errors"
	"sync"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

const (
	runtimeEventBufferSize    = 256
	defaultSubscriberBuffer   = 32
	maxRuntimeErrorMessageLen = 1024
)

type BotRuntimeState string

const (
	BotRuntimeIdle     BotRuntimeState = "idle"
	BotRuntimeWorking  BotRuntimeState = "working"
	BotRuntimeCooldown BotRuntimeState = "cooldown"
)

type RuntimeEventType string

const (
	RuntimeEventLeaseStarted     RuntimeEventType = "bot.lease.started"
	RuntimeEventLeaseFinished    RuntimeEventType = "bot.lease.finished"
	RuntimeEventCooldownStarted  RuntimeEventType = "bot.cooldown.started"
	RuntimeEventCooldownFinished RuntimeEventType = "bot.cooldown.finished"
	RuntimeEventQueueChanged     RuntimeEventType = "scheduler.queue.changed"
	RuntimeEventOperationSuccess RuntimeEventType = "operation.succeeded"
	RuntimeEventOperationFailure RuntimeEventType = "operation.failed"
)

type RuntimeLease struct {
	Operation  blobstore.LeaseOperation
	StartedAt  time.Time
	Duration   time.Duration
	UploadID   string
	ResourceID string
	FileName   string
	PartIndex  *int
	SizeBytes  int64
}

type RuntimeBotMetrics struct {
	OperationsSucceeded          uint64
	OperationsFailed             uint64
	RateLimitedCount             uint64
	BytesTransferred             int64
	LastSuccessAt                *time.Time
	LastErrorAt                  *time.Time
	LastErrorClass               ErrorClass
	LastErrorMessage             string
	LastOperationDuration        time.Duration
	LastThroughputBytesPerSecond float64
}

type RuntimeBot struct {
	UserID        string
	Username      string
	DisplayName   string
	Avatar        string
	State         BotRuntimeState
	Working       bool
	Cooling       bool
	CooldownUntil *time.Time
	Lease         *RuntimeLease
	Metrics       RuntimeBotMetrics
}

type RuntimeQueue struct {
	Depth      int
	OldestWait time.Duration
}

type SchedulerRuntimeSnapshot struct {
	GeneratedAt   time.Time
	Capacity      SchedulerCapacity
	Working       int
	Idle          int
	Cooldown      int
	ActiveLeases  int
	TotalWaiting  int
	Queues        map[blobstore.LeaseOperation]RuntimeQueue
	Bots          []RuntimeBot
	LatestEventID uint64
}

type RuntimeEvent struct {
	ID            uint64
	Type          RuntimeEventType
	At            time.Time
	BotUserID     string
	Operation     blobstore.LeaseOperation
	UploadID      string
	ResourceID    string
	FileName      string
	PartIndex     *int
	SizeBytes     int64
	Duration      time.Duration
	QueueDepth    int
	CooldownUntil *time.Time
	ErrorClass    ErrorClass
	Message       string
}

type RuntimeEventWindow struct {
	OldestID uint64
	LatestID uint64
	Events   []RuntimeEvent
}

type leaseRuntime struct {
	metadata  blobstore.LeaseMetadata
	startedAt time.Time
}

type botRuntimeMetrics struct {
	operationsSucceeded          uint64
	operationsFailed             uint64
	rateLimitedCount             uint64
	bytesTransferred             int64
	lastSuccessAt                time.Time
	lastErrorAt                  time.Time
	lastErrorClass               ErrorClass
	lastErrorMessage             string
	lastOperationDuration        time.Duration
	lastThroughputBytesPerSecond float64
}

func (s *Scheduler) Snapshot() SchedulerRuntimeSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	snapshot := SchedulerRuntimeSnapshot{
		GeneratedAt:   now,
		Capacity:      SchedulerCapacity{Configured: len(s.bots)},
		ActiveLeases:  len(s.leases),
		Queues:        make(map[blobstore.LeaseOperation]RuntimeQueue),
		Bots:          make([]RuntimeBot, 0, len(s.bots)),
		LatestEventID: s.eventSequence,
	}

	for operation, waiters := range s.waiters {
		if len(waiters) == 0 {
			continue
		}

		var oldest time.Time
		for _, startedAt := range waiters {
			if oldest.IsZero() || startedAt.Before(oldest) {
				oldest = startedAt
			}
		}

		queue := RuntimeQueue{Depth: len(waiters)}
		if !oldest.IsZero() && now.After(oldest) {
			queue.OldestWait = now.Sub(oldest)
		}

		snapshot.Queues[operation] = queue
		snapshot.TotalWaiting += queue.Depth
	}

	for _, bot := range s.bots {
		cooling, cooldownUntil := s.cooldownStateLocked(bot.UserID, now)
		working := s.busy[bot.UserID]

		if !cooling {
			snapshot.Capacity.Effective++
			if !working {
				snapshot.Capacity.Available++
			}
		}

		state := BotRuntimeIdle
		switch {
		case cooling:
			state = BotRuntimeCooldown
			snapshot.Cooldown++
		case working:
			state = BotRuntimeWorking
		default:
			snapshot.Idle++
		}

		if working {
			snapshot.Working++
		}

		runtimeBot := RuntimeBot{
			UserID:      bot.UserID,
			Username:    bot.Username,
			DisplayName: bot.DisplayName,
			Avatar:      bot.Avatar,
			State:       state,
			Working:     working,
			Cooling:     cooling,
			Metrics:     runtimeMetricsSnapshot(s.metrics[bot.UserID]),
		}

		if cooling {
			runtimeBot.CooldownUntil = timePointer(cooldownUntil)
		}

		if lease, ok := s.leases[bot.UserID]; ok {
			value := runtimeLeaseSnapshot(lease, now)
			runtimeBot.Lease = &value
		}

		snapshot.Bots = append(snapshot.Bots, runtimeBot)
	}

	return snapshot
}

func (s *Scheduler) EventsSince(after uint64) RuntimeEventWindow {
	s.mu.Lock()
	defer s.mu.Unlock()

	window := RuntimeEventWindow{
		LatestID: s.eventSequence,
		Events:   make([]RuntimeEvent, 0, len(s.events)),
	}

	if len(s.events) > 0 {
		window.OldestID = s.events[0].ID
	}

	for _, event := range s.events {
		if event.ID > after {
			window.Events = append(window.Events, event)
		}
	}

	return window
}

func (s *Scheduler) Subscribe(buffer int) (<-chan RuntimeEvent, func()) {
	if buffer <= 0 {
		buffer = defaultSubscriberBuffer
	}

	s.mu.Lock()
	s.nextSubscriberID++
	id := s.nextSubscriberID
	ch := make(chan RuntimeEvent, buffer)
	s.subscribers[id] = ch
	s.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			s.mu.Lock()
			if current, ok := s.subscribers[id]; ok {
				delete(s.subscribers, id)
				close(current)
			}
			s.mu.Unlock()
		})
	}

	return ch, cancel
}

func (s *Scheduler) RecordSuccess(userID string, bytesTransferred int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	metrics := s.metricsForLocked(userID)
	metrics.operationsSucceeded++
	metrics.lastSuccessAt = now

	if bytesTransferred > 0 {
		metrics.bytesTransferred += bytesTransferred
	}

	metadata, startedAt := s.operationMetadataLocked(userID)
	if !startedAt.IsZero() {
		metrics.lastOperationDuration = now.Sub(startedAt)
		if bytesTransferred > 0 && metrics.lastOperationDuration > 0 {
			metrics.lastThroughputBytesPerSecond = float64(bytesTransferred) / metrics.lastOperationDuration.Seconds()
		}
	}

	event := runtimeEventFromMetadata(RuntimeEventOperationSuccess, userID, metadata)
	event.Duration = metrics.lastOperationDuration
	s.emitLocked(event)
}

func (s *Scheduler) RecordFailure(userID string, err error) {
	if err == nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	class := ErrorUnavailable

	var upstream *UpstreamError
	if errors.As(err, &upstream) {
		class = upstream.Class
	}

	metrics := s.metricsForLocked(userID)
	metrics.operationsFailed++
	metrics.lastErrorAt = now
	metrics.lastErrorClass = class
	metrics.lastErrorMessage = runtimeErrorMessage(err)

	if class == ErrorRateLimited {
		metrics.rateLimitedCount++
	}

	metadata, startedAt := s.operationMetadataLocked(userID)
	if !startedAt.IsZero() {
		metrics.lastOperationDuration = now.Sub(startedAt)
	}

	event := runtimeEventFromMetadata(RuntimeEventOperationFailure, userID, metadata)
	event.Duration = metrics.lastOperationDuration
	event.ErrorClass = class
	event.Message = metrics.lastErrorMessage
	s.emitLocked(event)
}

func (s *Scheduler) capacityLocked(now time.Time) SchedulerCapacity {
	capacity := SchedulerCapacity{Configured: len(s.bots)}

	for _, bot := range s.bots {
		cooling, _ := s.cooldownStateLocked(bot.UserID, now)
		if cooling {
			continue
		}

		capacity.Effective++
		if !s.busy[bot.UserID] {
			capacity.Available++
		}
	}

	return capacity
}

func (s *Scheduler) cooldownStateLocked(userID string, now time.Time) (bool, time.Time) {
	until, exists := s.cooldown[userID]
	if !exists {
		return false, time.Time{}
	}
	if now.Before(until) {
		return true, until
	}

	delete(s.cooldown, userID)
	s.emitLocked(RuntimeEvent{
		Type:      RuntimeEventCooldownFinished,
		BotUserID: userID,
	})

	return false, time.Time{}
}

func (s *Scheduler) enqueueLocked(operation blobstore.LeaseOperation) uint64 {
	operation = normalizeOperation(operation)
	s.nextWaiterID++
	id := s.nextWaiterID

	waiters := s.waiters[operation]
	if waiters == nil {
		waiters = make(map[uint64]time.Time)
		s.waiters[operation] = waiters
	}

	waiters[id] = s.now()
	s.emitLocked(RuntimeEvent{
		Type:       RuntimeEventQueueChanged,
		Operation:  operation,
		QueueDepth: len(waiters),
	})

	return id
}

func (s *Scheduler) dequeueLocked(operation blobstore.LeaseOperation, waiterID uint64) {
	if waiterID == 0 {
		return
	}

	operation = normalizeOperation(operation)
	waiters := s.waiters[operation]
	if waiters == nil {
		return
	}

	delete(waiters, waiterID)
	depth := len(waiters)
	if depth == 0 {
		delete(s.waiters, operation)
	}

	s.emitLocked(RuntimeEvent{
		Type:       RuntimeEventQueueChanged,
		Operation:  operation,
		QueueDepth: depth,
	})
}

func (s *Scheduler) metricsForLocked(userID string) *botRuntimeMetrics {
	metrics := s.metrics[userID]
	if metrics == nil {
		metrics = &botRuntimeMetrics{}
		s.metrics[userID] = metrics
	}
	return metrics
}

func (s *Scheduler) operationMetadataLocked(userID string) (blobstore.LeaseMetadata, time.Time) {
	lease, ok := s.leases[userID]
	if !ok {
		return blobstore.LeaseMetadata{Operation: blobstore.LeaseOperationUnknown}, time.Time{}
	}
	return cloneLeaseMetadata(lease.metadata), lease.startedAt
}

func (s *Scheduler) emitLocked(event RuntimeEvent) {
	s.eventSequence++
	event.ID = s.eventSequence
	if event.At.IsZero() {
		event.At = s.now()
	}

	if len(s.events) >= runtimeEventBufferSize {
		copy(s.events, s.events[1:])
		s.events[len(s.events)-1] = event
	} else {
		s.events = append(s.events, event)
	}

	for _, subscriber := range s.subscribers {
		select {
		case subscriber <- event:
		default:
		}
	}
}

func runtimeLeaseSnapshot(lease leaseRuntime, now time.Time) RuntimeLease {
	metadata := cloneLeaseMetadata(lease.metadata)
	duration := time.Duration(0)
	if now.After(lease.startedAt) {
		duration = now.Sub(lease.startedAt)
	}

	return RuntimeLease{
		Operation:  metadata.Operation,
		StartedAt:  lease.startedAt,
		Duration:   duration,
		UploadID:   metadata.UploadID,
		ResourceID: metadata.ResourceID,
		FileName:   metadata.FileName,
		PartIndex:  metadata.PartIndex,
		SizeBytes:  metadata.SizeBytes,
	}
}

func runtimeMetricsSnapshot(metrics *botRuntimeMetrics) RuntimeBotMetrics {
	if metrics == nil {
		return RuntimeBotMetrics{}
	}

	return RuntimeBotMetrics{
		OperationsSucceeded:          metrics.operationsSucceeded,
		OperationsFailed:             metrics.operationsFailed,
		RateLimitedCount:             metrics.rateLimitedCount,
		BytesTransferred:             metrics.bytesTransferred,
		LastSuccessAt:                timePointer(metrics.lastSuccessAt),
		LastErrorAt:                  timePointer(metrics.lastErrorAt),
		LastErrorClass:               metrics.lastErrorClass,
		LastErrorMessage:             metrics.lastErrorMessage,
		LastOperationDuration:        metrics.lastOperationDuration,
		LastThroughputBytesPerSecond: metrics.lastThroughputBytesPerSecond,
	}
}

func runtimeEventFromMetadata(eventType RuntimeEventType, userID string, metadata blobstore.LeaseMetadata) RuntimeEvent {
	metadata = cloneLeaseMetadata(metadata)
	return RuntimeEvent{
		Type:       eventType,
		BotUserID:  userID,
		Operation:  metadata.Operation,
		UploadID:   metadata.UploadID,
		ResourceID: metadata.ResourceID,
		FileName:   metadata.FileName,
		PartIndex:  metadata.PartIndex,
		SizeBytes:  metadata.SizeBytes,
	}
}

func normalizeLeaseMetadata(metadata blobstore.LeaseMetadata) blobstore.LeaseMetadata {
	metadata = cloneLeaseMetadata(metadata)
	metadata.Operation = normalizeOperation(metadata.Operation)
	return metadata
}

func normalizeOperation(operation blobstore.LeaseOperation) blobstore.LeaseOperation {
	if operation == "" {
		return blobstore.LeaseOperationUnknown
	}
	return operation
}

func cloneLeaseMetadata(metadata blobstore.LeaseMetadata) blobstore.LeaseMetadata {
	if metadata.PartIndex != nil {
		value := *metadata.PartIndex
		metadata.PartIndex = &value
	}
	return metadata
}

func runtimeErrorMessage(err error) string {
	message := err.Error()
	if len(message) > maxRuntimeErrorMessageLen {
		return message[:maxRuntimeErrorMessageLen]
	}
	return message
}

func timePointer(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	copy := value
	return &copy
}
