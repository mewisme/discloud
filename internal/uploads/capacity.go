package uploads

type partConcurrencyProvider interface {
	RecommendedPartConcurrency() int
}

func (u *PartUploader) RecommendedPartConcurrency() int {
	if u == nil || u.blobs == nil {
		return 1
	}

	provider, ok := u.blobs.(partConcurrencyProvider)
	if !ok {
		return 1
	}

	concurrency := provider.RecommendedPartConcurrency()
	if concurrency < 1 {
		return 1
	}

	return concurrency
}
