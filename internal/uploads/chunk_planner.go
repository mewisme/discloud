package uploads

import "math"

const (
	adaptivePartsPerSlot        int64 = 2
	defaultMinAdaptiveChunkSize int64 = 2 * 1024 * 1024
	mediaMinAdaptiveChunkSize   int64 = 1 * 1024 * 1024
)

type CapacityProvider interface {
	EffectiveCapacity() int
}

type chunkPlanner struct {
	defaultChunkSize int64
	minChunkSize     int64
	capacity         CapacityProvider
}

func newChunkPlanner(defaultChunkSize int64, capacity CapacityProvider) *chunkPlanner {
	return newChunkPlannerWithMinimum(defaultChunkSize, defaultMinAdaptiveChunkSize, capacity)
}

func newMediaChunkPlanner(defaultChunkSize int64, capacity CapacityProvider) *chunkPlanner {
	return newChunkPlannerWithMinimum(defaultChunkSize, mediaMinAdaptiveChunkSize, capacity)
}

func newChunkPlannerWithMinimum(defaultChunkSize, minChunkSize int64, capacity CapacityProvider) *chunkPlanner {
	if minChunkSize <= 0 {
		minChunkSize = defaultChunkSize
	}
	if defaultChunkSize > 0 && minChunkSize > defaultChunkSize {
		minChunkSize = defaultChunkSize
	}

	return &chunkPlanner{
		defaultChunkSize: defaultChunkSize,
		minChunkSize:     minChunkSize,
		capacity:         capacity,
	}
}

func (p *chunkPlanner) Plan(size int64) int64 {
	if p == nil || p.defaultChunkSize <= 0 || size <= 0 || p.capacity == nil {
		if p == nil {
			return 0
		}
		return p.defaultChunkSize
	}

	capacity := p.capacity.EffectiveCapacity()
	if capacity <= 1 {
		return p.defaultChunkSize
	}

	defaultParts := ceilDiv(size, p.defaultChunkSize)
	targetParts := adaptiveTargetParts(capacity)

	if defaultParts >= targetParts {
		return p.defaultChunkSize
	}

	desiredChunkSize := ceilDiv(size, targetParts)

	switch {
	case desiredChunkSize < p.minChunkSize:
		return p.minChunkSize
	case desiredChunkSize > p.defaultChunkSize:
		return p.defaultChunkSize
	default:
		return desiredChunkSize
	}
}

func adaptiveTargetParts(capacity int) int64 {
	if capacity <= 1 {
		return 1
	}

	value := int64(capacity)
	if value > math.MaxInt32/adaptivePartsPerSlot {
		return math.MaxInt32
	}

	return value * adaptivePartsPerSlot
}

func ceilDiv(value, divisor int64) int64 {
	if value <= 0 || divisor <= 0 {
		return 0
	}

	result := value / divisor
	if value%divisor != 0 {
		result++
	}

	return result
}
