package discordstore

import (
	"context"
	"errors"
	"testing"

	"github.com/mewisme/discloud/internal/blobstore"
)

func TestSchedulerDrainWorkingBot(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	_, release, err := scheduler.Acquire(
		context.Background(),
		nil,
		blobstore.LeaseMetadata{
			Operation: blobstore.LeaseOperationUpload,
		},
	)
	if err != nil {
		t.Fatalf("Acquire(): %v", err)
	}

	if err := scheduler.Drain("1"); err != nil {
		t.Fatalf("Drain(): %v", err)
	}

	snapshot := scheduler.ControlledSnapshot()

	if snapshot.Bots[0].State != BotRuntimeDraining {
		t.Fatalf(
			"state = %q, want %q",
			snapshot.Bots[0].State,
			BotRuntimeDraining,
		)
	}

	if snapshot.Capacity.Effective != 0 {
		t.Fatalf(
			"effective capacity = %d, want 0",
			snapshot.Capacity.Effective,
		)
	}

	_, _, err = scheduler.Acquire(context.Background(), nil)
	if !errors.Is(err, blobstore.ErrNoUsableBot) {
		t.Fatalf(
			"Acquire() = %v, want ErrNoUsableBot",
			err,
		)
	}

	release()

	snapshot = scheduler.ControlledSnapshot()

	if snapshot.Bots[0].State != BotRuntimeDisabled {
		t.Fatalf(
			"state = %q, want %q",
			snapshot.Bots[0].State,
			BotRuntimeDisabled,
		)
	}
}

func TestSchedulerDisableAndEnableIdleBot(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	if err := scheduler.Disable("1"); err != nil {
		t.Fatalf("Disable(): %v", err)
	}

	snapshot := scheduler.ControlledSnapshot()

	if snapshot.Bots[0].State != BotRuntimeDisabled {
		t.Fatalf(
			"state = %q, want disabled",
			snapshot.Bots[0].State,
		)
	}

	if snapshot.Capacity.Effective != 0 {
		t.Fatalf(
			"effective capacity = %d, want 0",
			snapshot.Capacity.Effective,
		)
	}

	if err := scheduler.Enable("1"); err != nil {
		t.Fatalf("Enable(): %v", err)
	}

	snapshot = scheduler.ControlledSnapshot()

	if snapshot.Bots[0].State != BotRuntimeIdle {
		t.Fatalf(
			"state = %q, want idle",
			snapshot.Bots[0].State,
		)
	}

	if snapshot.Capacity.Effective != 1 {
		t.Fatalf(
			"effective capacity = %d, want 1",
			snapshot.Capacity.Effective,
		)
	}
}

func TestSchedulerUnhealthyBotIsExcluded(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	if err := scheduler.SetHealthy("1", false); err != nil {
		t.Fatalf("SetHealthy(): %v", err)
	}

	snapshot := scheduler.ControlledSnapshot()

	if snapshot.Bots[0].State != BotRuntimeUnhealthy {
		t.Fatalf(
			"state = %q, want unhealthy",
			snapshot.Bots[0].State,
		)
	}

	if snapshot.Capacity.Effective != 0 {
		t.Fatalf(
			"effective capacity = %d, want 0",
			snapshot.Capacity.Effective,
		)
	}
}

func TestSchedulerControlLeaseCanUseDisabledBot(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	if err := scheduler.Disable("1"); err != nil {
		t.Fatalf("Disable(): %v", err)
	}

	bot, release, err := scheduler.AcquireControl(
		context.Background(),
		"1",
		blobstore.LeaseMetadata{
			Operation: blobstore.LeaseOperationProbe,
		},
	)
	if err != nil {
		t.Fatalf("AcquireControl(): %v", err)
	}
	defer release()

	if bot.UserID != "1" {
		t.Fatalf("bot = %q, want 1", bot.UserID)
	}

	snapshot := scheduler.ControlledSnapshot()

	if snapshot.Bots[0].Lease == nil ||
		snapshot.Bots[0].Lease.Operation != blobstore.LeaseOperationProbe {
		t.Fatalf(
			"probe lease = %+v",
			snapshot.Bots[0].Lease,
		)
	}
}

func TestSchedulerControlsRejectUnknownBot(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1"}})

	for name, action := range map[string]func() error{
		"drain":   func() error { return scheduler.Drain("missing") },
		"disable": func() error { return scheduler.Disable("missing") },
		"enable":  func() error { return scheduler.Enable("missing") },
	} {
		t.Run(name, func(t *testing.T) {
			if err := action(); !errors.Is(err, ErrBotNotFound) {
				t.Fatalf(
					"error = %v, want ErrBotNotFound",
					err,
				)
			}
		})
	}
}
