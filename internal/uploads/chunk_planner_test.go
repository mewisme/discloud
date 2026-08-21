package uploads

import "testing"

const testMiB int64 = 1024 * 1024

type testCapacityProvider struct {
	capacity int
}

func (p *testCapacityProvider) EffectiveCapacity() int {
	return p.capacity
}

func TestChunkPlannerKeepsDefaultWithSingleBot(t *testing.T) {
	provider := &testCapacityProvider{capacity: 1}
	planner := newChunkPlanner(10*testMiB, provider)

	if got := planner.Plan(20 * testMiB); got != 10*testMiB {
		t.Fatalf("Plan() = %d, want %d", got, 10*testMiB)
	}
}

func TestChunkPlannerShrinksWhenDefaultPartsCannotFeedCapacity(t *testing.T) {
	provider := &testCapacityProvider{capacity: 8}
	planner := newChunkPlanner(10*testMiB, provider)

	if got := planner.Plan(20 * testMiB); got != 2*testMiB {
		t.Fatalf("Plan() = %d, want %d", got, 2*testMiB)
	}
}

func TestChunkPlannerUsesCalculatedChunkAboveFloor(t *testing.T) {
	provider := &testCapacityProvider{capacity: 8}
	planner := newChunkPlanner(10*testMiB, provider)

	if got := planner.Plan(80 * testMiB); got != 5*testMiB {
		t.Fatalf("Plan() = %d, want %d", got, 5*testMiB)
	}
}

func TestChunkPlannerKeepsDefaultWhenFileAlreadyHasEnoughParts(t *testing.T) {
	provider := &testCapacityProvider{capacity: 8}
	planner := newChunkPlanner(10*testMiB, provider)

	if got := planner.Plan(1024 * testMiB); got != 10*testMiB {
		t.Fatalf("Plan() = %d, want %d", got, 10*testMiB)
	}
}

func TestChunkPlannerDoesNotIncreaseConfiguredChunkSize(t *testing.T) {
	provider := &testCapacityProvider{capacity: 16}
	planner := newChunkPlanner(testMiB, provider)

	if got := planner.Plan(20 * testMiB); got != testMiB {
		t.Fatalf("Plan() = %d, want %d", got, testMiB)
	}
}

func TestChunkPlannerKeepsDefaultForZeroSize(t *testing.T) {
	provider := &testCapacityProvider{capacity: 8}
	planner := newChunkPlanner(10*testMiB, provider)

	if got := planner.Plan(0); got != 10*testMiB {
		t.Fatalf("Plan() = %d, want %d", got, 10*testMiB)
	}
}

func TestChunkPlannerKeepsDefaultWithoutCapacityProvider(t *testing.T) {
	planner := newChunkPlanner(10*testMiB, nil)

	if got := planner.Plan(20 * testMiB); got != 10*testMiB {
		t.Fatalf("Plan() = %d, want %d", got, 10*testMiB)
	}
}

func TestChunkPlannerUsesCurrentCapacityPerPlan(t *testing.T) {
	provider := &testCapacityProvider{capacity: 8}
	planner := newChunkPlanner(10*testMiB, provider)

	if got := planner.Plan(20 * testMiB); got != 2*testMiB {
		t.Fatalf("Plan(capacity=8) = %d, want %d", got, 2*testMiB)
	}

	provider.capacity = 1

	if got := planner.Plan(20 * testMiB); got != 10*testMiB {
		t.Fatalf("Plan(capacity=1) = %d, want %d", got, 10*testMiB)
	}
}

func TestAdaptiveTargetParts(t *testing.T) {
	tests := []struct {
		capacity int
		want     int64
	}{
		{capacity: 0, want: 1},
		{capacity: 1, want: 1},
		{capacity: 2, want: 4},
		{capacity: 8, want: 16},
		{capacity: 16, want: 32},
	}

	for _, test := range tests {
		if got := adaptiveTargetParts(test.capacity); got != test.want {
			t.Fatalf(
				"adaptiveTargetParts(%d) = %d, want %d",
				test.capacity,
				got,
				test.want,
			)
		}
	}
}
