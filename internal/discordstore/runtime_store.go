package discordstore

import (
	"context"
	"errors"

	"github.com/mewisme/discloud/internal/blobstore"
)

func (s *Store) RuntimeSnapshot() SchedulerRuntimeSnapshot {
	return s.scheduler.ControlledSnapshot()
}

func (s *Store) RuntimeEventsSince(after uint64) RuntimeEventWindow {
	return s.scheduler.EventsSince(after)
}

func (s *Store) SubscribeRuntime(buffer int) (<-chan RuntimeEvent, func()) {
	return s.scheduler.Subscribe(buffer)
}

func (s *Store) ProbeBot(ctx context.Context, userID string) error {
	bot, release, err := s.scheduler.AcquireControl(
		ctx,
		userID,
		blobstore.LeaseMetadata{
			Operation: blobstore.LeaseOperationProbe,
		},
	)
	if err != nil {
		return err
	}
	defer release()

	user, err := s.client.CurrentUser(ctx, bot.Token)
	if err != nil {
		classified := classifyError(bot.UserID, err)
		s.scheduler.RecordFailure(bot.UserID, classified)
		s.applyCooldown(bot.UserID, classified)

		if probeFailureMarksUnhealthy(classified) {
			_ = s.scheduler.SetHealthy(bot.UserID, false)
		}

		return classified
	}

	if user.ID != bot.UserID || !user.Bot {
		protocolErr := &UpstreamError{
			Class:     ErrorProtocol,
			BotUserID: bot.UserID,
			Retryable: false,
			Cause:     ErrBotIdentityMismatch,
		}

		s.scheduler.RecordFailure(bot.UserID, protocolErr)
		_ = s.scheduler.SetHealthy(bot.UserID, false)
		return protocolErr
	}

	displayName := user.GlobalName
	if displayName == "" {
		displayName = user.Username
	}

	if err := s.scheduler.UpdateBotIdentity(
		bot.UserID,
		user.Username,
		displayName,
		user.Avatar,
	); err != nil {
		return err
	}

	_ = s.scheduler.SetHealthy(bot.UserID, true)
	s.scheduler.RecordSuccess(bot.UserID, 0)
	return nil
}

func (s *Store) DrainBot(userID string) error {
	return s.scheduler.Drain(userID)
}

func (s *Store) DisableBot(userID string) error {
	return s.scheduler.Disable(userID)
}

func (s *Store) EnableBot(userID string) error {
	return s.scheduler.Enable(userID)
}

func probeFailureMarksUnhealthy(err error) bool {
	var upstream *UpstreamError
	if !errors.As(err, &upstream) {
		return false
	}

	return upstream.Class == ErrorAuth ||
		upstream.Class == ErrorProtocol
}
