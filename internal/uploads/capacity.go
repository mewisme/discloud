package uploads

const (
	minPartConcurrency = 1
	maxPartConcurrency = 12
)

type partConcurrencyProvider interface {
	RecommendedPartConcurrency() int
}

func (u *PartUploader) RecommendedPartConcurrency() int {
	if u == nil || u.blobs == nil {
		return minPartConcurrency
	}

	provider, ok := u.blobs.(partConcurrencyProvider)
	if !ok {
		return minPartConcurrency
	}

	concurrency := provider.RecommendedPartConcurrency()
	if concurrency < minPartConcurrency {
		return minPartConcurrency
	}
	if concurrency > maxPartConcurrency {
		return maxPartConcurrency
	}

	return concurrency
}

func (u *PartUploader) tryAcquirePartSlot() bool {
	if u == nil || u.partSlots == nil {
		return false
	}

	select {
	case u.partSlots <- struct{}{}:
		return true
	default:
		return false
	}
}

func (u *PartUploader) releasePartSlot() {
	<-u.partSlots
}
