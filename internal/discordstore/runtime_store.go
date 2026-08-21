package discordstore

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/mewisme/discloud/internal/blobstore"
)

type BotRuntimeEntry struct {
	ConfigIndex int
	Resolved    bool
	RuntimeBot
	ResolveErrorClass   string
	ResolveErrorMessage string
}

type BotRuntimeSnapshot struct {
	SchedulerRuntimeSnapshot
	Resolved   int
	Unresolved int
	Bots       []BotRuntimeEntry
}

func (s *Store) RuntimeSnapshot() BotRuntimeSnapshot {
	if s.configured == nil {
		base := s.scheduler.ControlledSnapshot()
		bots := make([]BotRuntimeEntry, 0, len(base.Bots))
		for index, bot := range base.Bots {
			bots = append(bots, BotRuntimeEntry{ConfigIndex: index, Resolved: true, RuntimeBot: bot})
		}
		return BotRuntimeSnapshot{
			SchedulerRuntimeSnapshot: base,
			Resolved:                 len(bots),
			Bots:                     bots,
		}
	}

	s.configured.probeMu.Lock()
	defer s.configured.probeMu.Unlock()

	base := s.scheduler.ControlledSnapshot()
	configured := s.configured.snapshot()
	configIndexByUserID := make(map[string]int, len(configured))

	for _, entry := range configured {
		if entry.UserID != "" {
			configIndexByUserID[entry.UserID] = entry.ConfigIndex
		}
	}

	bots := make([]BotRuntimeEntry, 0, len(configured))
	resolved := 0

	for _, bot := range base.Bots {
		configIndex, ok := configIndexByUserID[bot.UserID]
		if !ok {
			continue
		}

		bots = append(bots, BotRuntimeEntry{
			ConfigIndex: configIndex,
			Resolved:    true,
			RuntimeBot:  bot,
		})
		resolved++
	}

	for _, entry := range configured {
		if entry.UserID != "" {
			continue
		}

		bots = append(bots, BotRuntimeEntry{
			ConfigIndex: entry.ConfigIndex,
			Resolved:    false,
			RuntimeBot: RuntimeBot{
				State: BotRuntimeUnhealthy,
			},
			ResolveErrorClass:   entry.ResolveErrorClass,
			ResolveErrorMessage: entry.ResolveErrorMessage,
		})
	}

	sort.Slice(bots, func(i, j int) bool {
		return bots[i].ConfigIndex < bots[j].ConfigIndex
	})

	base.Capacity.Configured = len(configured)

	return BotRuntimeSnapshot{
		SchedulerRuntimeSnapshot: base,
		Resolved:                 resolved,
		Unresolved:               len(configured) - resolved,
		Bots:                     bots,
	}
}

func (s *Store) RuntimeEventsSince(after uint64) RuntimeEventWindow {
	return s.scheduler.EventsSince(after)
}

func (s *Store) SubscribeRuntime(buffer int) (<-chan RuntimeEvent, func()) {
	return s.scheduler.Subscribe(buffer)
}

func (s *Store) ProbeConfiguredBot(ctx context.Context, configIndex int) error {
	if s.configured == nil {
		return ErrConfiguredBotNotFound
	}

	s.configured.probeMu.Lock()
	entry, ok := s.configured.get(configIndex)
	if !ok {
		s.configured.probeMu.Unlock()
		return ErrConfiguredBotNotFound
	}

	if entry.UserID != "" {
		s.configured.probeMu.Unlock()
		return s.ProbeBot(ctx, entry.UserID)
	}

	bot, err := resolveConfiguredBotIdentity(ctx, s.client, entry.Token)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			s.configured.probeMu.Unlock()
			return ctxErr
		}
		s.configured.setError(configIndex, err)
		s.configured.probeMu.Unlock()
		return err
	}

	if _, exists := s.scheduler.Get(bot.UserID); exists {
		err = fmt.Errorf("%w: %s", ErrDuplicateBotUser, bot.UserID)
		s.configured.setError(configIndex, err)
		s.configured.probeMu.Unlock()
		return err
	}

	if err := s.scheduler.AddBot(bot); err != nil {
		s.configured.setError(configIndex, err)
		s.configured.probeMu.Unlock()
		return err
	}

	s.configured.markResolved(configIndex, bot.UserID)
	s.configured.probeMu.Unlock()
	return nil
}

func (s *Store) ProbeBot(ctx context.Context, userID string) error {
	bot, release, err := s.scheduler.AcquireControl(
		ctx,
		userID,
		blobstore.LeaseMetadata{Operation: blobstore.LeaseOperationProbe},
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

	if err := s.scheduler.UpdateBotIdentity(bot.UserID, user.Username, displayName, user.Avatar); err != nil {
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
	return upstream.Class == ErrorAuth || upstream.Class == ErrorProtocol
}
