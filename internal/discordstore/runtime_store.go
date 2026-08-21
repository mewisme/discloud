package discordstore

func (s *Store) RuntimeSnapshot() SchedulerRuntimeSnapshot {
	return s.scheduler.Snapshot()
}

func (s *Store) RuntimeEventsSince(after uint64) RuntimeEventWindow {
	return s.scheduler.EventsSince(after)
}

func (s *Store) SubscribeRuntime(buffer int) (<-chan RuntimeEvent, func()) {
	return s.scheduler.Subscribe(buffer)
}
