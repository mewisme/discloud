package discordstore

func (s *Store) EffectiveCapacity() int {
	return s.scheduler.Capacity().Effective
}

func (s *Store) RecommendedPartConcurrency() int {
	concurrency := s.EffectiveCapacity()
	if concurrency < 1 {
		return 1
	}
	return concurrency
}
