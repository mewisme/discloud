package discordstore

import (
	"context"
	"errors"
	"fmt"
)

var (
	ErrNoBotTokens      = errors.New("no Discord bot tokens configured")
	ErrInvalidBotToken  = errors.New("configured Discord token is not a bot")
	ErrDuplicateBotUser = errors.New("duplicate Discord bot user")
)

type Bot struct {
	UserID      string
	Username    string
	DisplayName string
	Avatar      string
	Token       string
}

func ResolveBots(ctx context.Context, client *Client, tokens []string) ([]Bot, error) {
	if len(tokens) == 0 {
		return nil, ErrNoBotTokens
	}

	bots := make([]Bot, 0, len(tokens))
	seen := make(map[string]struct{}, len(tokens))

	for _, token := range tokens {
		user, err := client.CurrentUser(ctx, token)
		if err != nil {
			return nil, fmt.Errorf("resolve Discord bot identity: %w", err)
		}
		if user.ID == "" || !user.Bot {
			return nil, ErrInvalidBotToken
		}
		if _, exists := seen[user.ID]; exists {
			return nil, fmt.Errorf("%w: %s", ErrDuplicateBotUser, user.ID)
		}

		displayName := user.GlobalName
		if displayName == "" {
			displayName = user.Username
		}

		seen[user.ID] = struct{}{}
		bots = append(bots, Bot{
			UserID:      user.ID,
			Username:    user.Username,
			DisplayName: displayName,
			Avatar:      user.Avatar,
			Token:       token,
		})
	}

	return bots, nil
}
