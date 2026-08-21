package uploads

import "testing"

func TestMediaChunkPlannerUsesOneMiBFloor(t *testing.T) {
	t.Parallel()

	provider := &testCapacityProvider{capacity: 8}
	planner := newMediaChunkPlanner(5*testMiB, provider)

	if got := planner.Plan(4 * testMiB); got != testMiB {
		t.Fatalf("Plan() = %d, want %d", got, testMiB)
	}
}

func TestMediaChunkPlannerUsesFiveMiBCeilingWithSingleBot(t *testing.T) {
	t.Parallel()

	provider := &testCapacityProvider{capacity: 1}
	planner := newMediaChunkPlanner(5*testMiB, provider)

	if got := planner.Plan(100 * testMiB); got != 5*testMiB {
		t.Fatalf("Plan() = %d, want %d", got, 5*testMiB)
	}
}

func TestMediaChunkPlannerUsesConfiguredCeiling(t *testing.T) {
	t.Parallel()

	provider := &testCapacityProvider{capacity: 1}
	planner := newMediaChunkPlanner(3*testMiB, provider)

	if got := planner.Plan(100 * testMiB); got != 3*testMiB {
		t.Fatalf("Plan() = %d, want %d", got, 3*testMiB)
	}
}

func TestMediaChunkPlannerAdaptsBetweenFloorAndCeiling(t *testing.T) {
	t.Parallel()

	provider := &testCapacityProvider{capacity: 8}
	planner := newMediaChunkPlanner(5*testMiB, provider)

	if got := planner.Plan(48 * testMiB); got != 3*testMiB {
		t.Fatalf("Plan() = %d, want %d", got, 3*testMiB)
	}
}
