package discordstore

import (
	"context"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

type fairnessLeaseResult struct {
	operation  blobstore.LeaseOperation
	resourceID string
	release    func()
	err        error
}

func TestSchedulerFairnessRotatesWaitingOperationClasses(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	_, releaseBlocker, err := scheduler.Acquire(
		context.Background(),
		nil,
		blobstore.LeaseMetadata{
			Operation: blobstore.LeaseOperationUpload,
		},
	)
	if err != nil {
		t.Fatalf("Acquire(blocker): %v", err)
	}

	results := make(
		chan fairnessLeaseResult,
		4,
	)

	startFairnessLease(
		scheduler,
		nil,
		blobstore.LeaseOperationUpload,
		"upload-1",
		results,
	)

	startFairnessLease(
		scheduler,
		nil,
		blobstore.LeaseOperationUpload,
		"upload-2",
		results,
	)

	startFairnessLease(
		scheduler,
		nil,
		blobstore.LeaseOperationResolve,
		"resolve-1",
		results,
	)

	startFairnessLease(
		scheduler,
		nil,
		blobstore.LeaseOperationDelete,
		"delete-1",
		results,
	)

	waitForRuntimeQueues(
		t,
		scheduler,
		map[blobstore.LeaseOperation]int{
			blobstore.LeaseOperationUpload:  2,
			blobstore.LeaseOperationResolve: 1,
			blobstore.LeaseOperationDelete:  1,
		},
	)

	releaseBlocker()

	expected := []blobstore.LeaseOperation{
		blobstore.LeaseOperationResolve,
		blobstore.LeaseOperationDelete,
		blobstore.LeaseOperationUpload,
		blobstore.LeaseOperationUpload,
	}

	for index, want := range expected {
		result := receiveFairnessLease(
			t,
			results,
		)

		if result.err != nil {
			t.Fatalf(
				"lease %d: %v",
				index,
				result.err,
			)
		}

		if result.operation != want {
			t.Fatalf(
				"lease %d operation = %q, want %q",
				index,
				result.operation,
				want,
			)
		}

		result.release()
	}
}

func TestSchedulerFairnessLetsOneClassUseWholePool(t *testing.T) {
	scheduler := NewScheduler([]Bot{
		{UserID: "1"},
		{UserID: "2"},
		{UserID: "3"},
	})

	blockers := make([]func(), 0, 3)

	for range 3 {
		_, release, err := scheduler.Acquire(
			context.Background(),
			nil,
			blobstore.LeaseMetadata{
				Operation: blobstore.LeaseOperationResolve,
			},
		)
		if err != nil {
			t.Fatalf("Acquire(blocker): %v", err)
		}

		blockers = append(
			blockers,
			release,
		)
	}

	results := make(
		chan fairnessLeaseResult,
		3,
	)

	for index := range 3 {
		startFairnessLease(
			scheduler,
			nil,
			blobstore.LeaseOperationUpload,
			string(rune('a'+index)),
			results,
		)
	}

	waitForRuntimeQueues(
		t,
		scheduler,
		map[blobstore.LeaseOperation]int{
			blobstore.LeaseOperationUpload: 3,
		},
	)

	for _, release := range blockers {
		release()
	}

	acquired := make(
		[]fairnessLeaseResult,
		0,
		3,
	)

	for range 3 {
		result := receiveFairnessLease(
			t,
			results,
		)

		if result.err != nil {
			t.Fatalf("Acquire(upload): %v", result.err)
		}

		if result.operation != blobstore.LeaseOperationUpload {
			t.Fatalf(
				"operation = %q, want upload",
				result.operation,
			)
		}

		acquired = append(
			acquired,
			result,
		)
	}

	if snapshot := scheduler.Snapshot(); snapshot.Working != 3 {
		t.Fatalf(
			"working = %d, want 3",
			snapshot.Working,
		)
	}

	for _, result := range acquired {
		result.release()
	}
}

func TestSchedulerFairnessSkipsWaiterThatCannotUseFreeBot(t *testing.T) {
	scheduler := NewScheduler([]Bot{
		{UserID: "1"},
		{UserID: "2"},
	})

	blocker, releaseBlocker, err := scheduler.Acquire(
		context.Background(),
		[]string{"2"},
		blobstore.LeaseMetadata{
			Operation: blobstore.LeaseOperationUnknown,
		},
	)
	if err != nil {
		t.Fatalf("Acquire(blocker): %v", err)
	}

	if blocker.UserID != "1" {
		t.Fatalf(
			"blocker bot = %q, want 1",
			blocker.UserID,
		)
	}

	results := make(
		chan fairnessLeaseResult,
		1,
	)

	startFairnessLease(
		scheduler,
		[]string{"2"},
		blobstore.LeaseOperationUpload,
		"upload",
		results,
	)

	waitForRuntimeQueues(
		t,
		scheduler,
		map[blobstore.LeaseOperation]int{
			blobstore.LeaseOperationUpload: 1,
		},
	)

	ctx, cancel := context.WithTimeout(
		context.Background(),
		time.Second,
	)
	defer cancel()

	resolved, releaseResolve, err := scheduler.Acquire(
		ctx,
		nil,
		blobstore.LeaseMetadata{
			Operation: blobstore.LeaseOperationResolve,
		},
	)
	if err != nil {
		t.Fatalf("Acquire(resolve): %v", err)
	}

	if resolved.UserID != "2" {
		t.Fatalf(
			"resolve bot = %q, want 2",
			resolved.UserID,
		)
	}

	releaseResolve()
	releaseBlocker()

	upload := receiveFairnessLease(
		t,
		results,
	)

	if upload.err != nil {
		t.Fatalf("Acquire(upload): %v", upload.err)
	}

	if upload.operation != blobstore.LeaseOperationUpload {
		t.Fatalf(
			"operation = %q, want upload",
			upload.operation,
		)
	}

	upload.release()
}

func TestSchedulerFairnessPreservesFIFOWithinOperation(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	_, releaseBlocker, err := scheduler.Acquire(
		context.Background(),
		nil,
		blobstore.LeaseMetadata{
			Operation: blobstore.LeaseOperationUnknown,
		},
	)
	if err != nil {
		t.Fatalf("Acquire(blocker): %v", err)
	}

	results := make(
		chan fairnessLeaseResult,
		2,
	)

	startFairnessLease(
		scheduler,
		nil,
		blobstore.LeaseOperationUpload,
		"first",
		results,
	)

	waitForRuntimeQueues(
		t,
		scheduler,
		map[blobstore.LeaseOperation]int{
			blobstore.LeaseOperationUpload: 1,
		},
	)

	startFairnessLease(
		scheduler,
		nil,
		blobstore.LeaseOperationUpload,
		"second",
		results,
	)

	waitForRuntimeQueues(
		t,
		scheduler,
		map[blobstore.LeaseOperation]int{
			blobstore.LeaseOperationUpload: 2,
		},
	)

	releaseBlocker()

	first := receiveFairnessLease(
		t,
		results,
	)

	if first.err != nil {
		t.Fatalf("Acquire(first): %v", first.err)
	}

	if first.resourceID != "first" {
		t.Fatalf(
			"first resource = %q, want first",
			first.resourceID,
		)
	}

	first.release()

	second := receiveFairnessLease(
		t,
		results,
	)

	if second.err != nil {
		t.Fatalf("Acquire(second): %v", second.err)
	}

	if second.resourceID != "second" {
		t.Fatalf(
			"second resource = %q, want second",
			second.resourceID,
		)
	}

	second.release()
}

func startFairnessLease(
	scheduler *Scheduler,
	excluded []string,
	operation blobstore.LeaseOperation,
	resourceID string,
	results chan<- fairnessLeaseResult,
) {
	go func() {
		_, release, err := scheduler.Acquire(
			context.Background(),
			excluded,
			blobstore.LeaseMetadata{
				Operation:  operation,
				ResourceID: resourceID,
			},
		)

		results <- fairnessLeaseResult{
			operation:  operation,
			resourceID: resourceID,
			release:    release,
			err:        err,
		}
	}()
}

func receiveFairnessLease(
	t *testing.T,
	results <-chan fairnessLeaseResult,
) fairnessLeaseResult {
	t.Helper()

	select {
	case result := <-results:
		return result

	case <-time.After(time.Second):
		t.Fatal("timed out waiting for scheduler lease")
		return fairnessLeaseResult{}
	}
}

func waitForRuntimeQueues(
	t *testing.T,
	scheduler *Scheduler,
	expected map[blobstore.LeaseOperation]int,
) {
	t.Helper()

	deadline := time.Now().Add(time.Second)

	for {
		snapshot := scheduler.Snapshot()
		matched := true

		for operation, depth := range expected {
			if snapshot.Queues[operation].Depth != depth {
				matched = false
				break
			}
		}

		if matched {
			return
		}

		if time.Now().After(deadline) {
			t.Fatalf(
				"queues = %+v, want %+v",
				snapshot.Queues,
				expected,
			)
		}

		time.Sleep(time.Millisecond)
	}
}
