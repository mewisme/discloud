package discordstore

import (
	"context"
	"errors"
	"net/http"

	"github.com/mewisme/discloud/internal/blobstore"
)

func (s *Store) DeleteChunk(ctx context.Context, location blobstore.ChunkLocation) error {
	if location.DiscordChannelID == "" ||
		location.DiscordMessageID == "" ||
		location.DiscordChannelID != s.channelID {
		return blobstore.ErrInvalidChunk
	}

	excluded := make([]string, 0, s.scheduler.Len())
	var lastErr error

	for len(excluded) < s.scheduler.Len() {
		if err := ctx.Err(); err != nil {
			return classifyError("", err)
		}

		bot, err := s.scheduler.Next(excluded)
		if err != nil {
			if lastErr != nil {
				return lastErr
			}
			return err
		}
		excluded = append(excluded, bot.UserID)

		err = s.client.DeleteMessage(
			ctx,
			bot.Token,
			location.DiscordChannelID,
			location.DiscordMessageID,
		)
		if err == nil {
			return nil
		}

		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusNotFound {
			return nil
		}

		classified := classifyError(bot.UserID, err)
		s.applyCooldown(bot.UserID, classified)
		lastErr = classified
	}

	if lastErr != nil {
		return lastErr
	}
	return blobstore.ErrNoUsableBot
}
