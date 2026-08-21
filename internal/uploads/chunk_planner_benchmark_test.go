package uploads

import (
	"fmt"
	"testing"
)

const benchmarkMiB int64 = 1024 * 1024

var benchmarkChunkPlan int64

type benchmarkCapacityProvider struct {
	capacity int
}

func (p *benchmarkCapacityProvider) EffectiveCapacity() int {
	return p.capacity
}

func BenchmarkChunkPlannerMatrix(b *testing.B) {
	const defaultChunkSize int64 = 10 * benchmarkMiB

	files := []struct {
		name string
		size int64
	}{
		{name: "20MiB", size: 20 * benchmarkMiB},
		{name: "80MiB", size: 80 * benchmarkMiB},
		{name: "1GiB", size: 1024 * benchmarkMiB},
	}

	modes := []struct {
		name     string
		adaptive bool
		floor    int64
	}{
		{name: "fixed"},
		{name: "adaptive-1MiB", adaptive: true, floor: benchmarkMiB},
		{name: "adaptive-2MiB", adaptive: true, floor: 2 * benchmarkMiB},
		{name: "adaptive-4MiB", adaptive: true, floor: 4 * benchmarkMiB},
	}

	for _, mode := range modes {
		for _, capacity := range []int{1, 2, 4, 8, 16} {
			for _, file := range files {
				provider := &benchmarkCapacityProvider{capacity: capacity}
				planner := &chunkPlanner{
					defaultChunkSize: defaultChunkSize,
					minChunkSize:     mode.floor,
					capacity:         provider,
				}

				if !mode.adaptive {
					planner.capacity = nil
					planner.minChunkSize = defaultChunkSize
				}

				plannedChunkSize := planner.Plan(file.size)
				parts, err := partCount(file.size, plannedChunkSize)
				if err != nil {
					b.Fatalf("partCount(): %v", err)
				}

				name := fmt.Sprintf("mode=%s/bots=%d/file=%s", mode.name, capacity, file.name)

				b.Run(name, func(b *testing.B) {
					b.ReportAllocs()
					b.ReportMetric(float64(plannedChunkSize)/float64(benchmarkMiB), "MiB/chunk")
					b.ReportMetric(float64(parts), "parts/file")

					var result int64
					for b.Loop() {
						result = planner.Plan(file.size)
					}
					benchmarkChunkPlan = result
				})
			}
		}
	}
}
