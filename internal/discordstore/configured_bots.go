package discordstore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
)

var ErrConfiguredBotNotFound = errors.New("configured Discord bot not found")

type configuredBot struct {
	ConfigIndex         int
	Token               string
	UserID              string
	ResolveErrorClass   string
	ResolveErrorMessage string
}

type configuredBotRegistry struct {
	mu      sync.RWMutex
	probeMu sync.Mutex
	entries []configuredBot
}

func resolveConfiguredBots(ctx context.Context, client *Client, tokens []string) (*configuredBotRegistry, []Bot, error) {
	if len(tokens) == 0 {
		return nil, nil, ErrNoBotTokens
	}

	registry := &configuredBotRegistry{entries: make([]configuredBot, len(tokens))}
	bots := make([]Bot, 0, len(tokens))
	seen := make(map[string]struct{}, len(tokens))

	for index, token := range tokens {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}

		entry := configuredBot{ConfigIndex: index, Token: token}
		bot, err := resolveConfiguredBotIdentity(ctx, client, token)
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return nil, nil, ctxErr
			}
			entry.ResolveErrorClass, entry.ResolveErrorMessage = configuredBotDiagnostic(err)
			registry.entries[index] = entry
			continue
		}

		if _, exists := seen[bot.UserID]; exists {
			err = fmt.Errorf("%w: %s", ErrDuplicateBotUser, bot.UserID)
			entry.ResolveErrorClass, entry.ResolveErrorMessage = configuredBotDiagnostic(err)
			registry.entries[index] = entry
			continue
		}

		seen[bot.UserID] = struct{}{}
		entry.UserID = bot.UserID
		registry.entries[index] = entry
		bots = append(bots, bot)
	}

	return registry, bots, nil
}

func resolveConfiguredBotIdentity(ctx context.Context, client *Client, token string) (Bot, error) {
	if strings.TrimSpace(token) == "" {
		return Bot{}, ErrInvalidBotToken
	}

	user, err := client.CurrentUser(ctx, token)
	if err != nil {
		return Bot{}, classifyError("", err)
	}
	if user.ID == "" || !user.Bot {
		return Bot{}, ErrInvalidBotToken
	}

	displayName := user.GlobalName
	if displayName == "" {
		displayName = user.Username
	}

	return Bot{
		UserID:      user.ID,
		Username:    user.Username,
		DisplayName: displayName,
		Avatar:      user.Avatar,
		Token:       token,
	}, nil
}

func configuredBotDiagnostic(err error) (string, string) {
	switch {
	case errors.Is(err, ErrDuplicateBotUser):
		return "duplicate", "Configured Discord bot identity duplicates another configured bot"
	case errors.Is(err, ErrInvalidBotToken):
		return "invalid", "Configured Discord token did not resolve to a bot account"
	}

	var upstream *UpstreamError
	if !errors.As(err, &upstream) {
		return "unavailable", "Discord bot identity could not be resolved"
	}

	switch upstream.Class {
	case ErrorAuth:
		return string(ErrorAuth), "Discord authentication failed"
	case ErrorTimeout:
		return string(ErrorTimeout), "Discord identity request timed out"
	case ErrorRateLimited:
		return string(ErrorRateLimited), "Discord rate limited the identity request"
	case ErrorRequest:
		return string(ErrorRequest), "Discord rejected the identity request"
	case ErrorProtocol:
		return string(ErrorProtocol), "Discord returned an invalid identity response"
	case ErrorCanceled:
		return string(ErrorCanceled), "Discord identity request was canceled"
	default:
		return string(ErrorUnavailable), "Discord identity service is unavailable"
	}
}

func (r *configuredBotRegistry) snapshot() []configuredBot {
	if r == nil {
		return nil
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	entries := make([]configuredBot, len(r.entries))
	copy(entries, r.entries)
	return entries
}

func (r *configuredBotRegistry) get(configIndex int) (configuredBot, bool) {
	if r == nil {
		return configuredBot{}, false
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	if configIndex < 0 || configIndex >= len(r.entries) {
		return configuredBot{}, false
	}
	return r.entries[configIndex], true
}

func (r *configuredBotRegistry) setError(configIndex int, err error) {
	class, message := configuredBotDiagnostic(err)

	r.mu.Lock()
	defer r.mu.Unlock()

	if configIndex < 0 || configIndex >= len(r.entries) {
		return
	}

	r.entries[configIndex].UserID = ""
	r.entries[configIndex].ResolveErrorClass = class
	r.entries[configIndex].ResolveErrorMessage = message
}

func (r *configuredBotRegistry) markResolved(configIndex int, userID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if configIndex < 0 || configIndex >= len(r.entries) {
		return
	}

	r.entries[configIndex].UserID = userID
	r.entries[configIndex].ResolveErrorClass = ""
	r.entries[configIndex].ResolveErrorMessage = ""
}
