package discordstore

func (s *Store) RecommendedPartConcurrency() int {
	concurrency := s.scheduler.Capacity().Effective
	if concurrency < 1 {
		return 1
	}
	return concurrency
}
