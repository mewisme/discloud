package discordstore

func (s *Scheduler) AddBot(bot Bot) error {
	if bot.UserID == "" || bot.Token == "" {
		return ErrInvalidBotToken
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.findBotLocked(bot.UserID); exists {
		return ErrDuplicateBotUser
	}

	s.bots = append(s.bots, bot)
	s.controls[bot.UserID] = &botControl{enabled: true, healthy: true}
	s.emitLocked(RuntimeEvent{Type: RuntimeEventBotIdentityUpdated, BotUserID: bot.UserID})
	s.notifyLocked()
	return nil
}
