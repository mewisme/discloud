package discordstore

import (
	"context"
	"errors"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

func (s *Store) AcquireUploadBot(ctx context.Context, excludedBotUserIDs []string) (string, func(), error) {
	return s.AcquireUploadBotFor(
		ctx,
		excludedBotUserIDs,
		blobstore.LeaseMetadata{Operation: blobstore.LeaseOperationUpload},
	)
}

func (s *Store) AcquireUploadBotFor(
	ctx context.Context,
	excludedBotUserIDs []string,
	metadata blobstore.LeaseMetadata,
) (string, func(), error) {
	if metadata.Operation == "" {
		metadata.Operation = blobstore.LeaseOperationUpload
	}

	bot, release, err := s.scheduler.Acquire(ctx, excludedBotUserIDs, metadata)
	if err != nil {
		return "", nil, err
	}

	return bot.UserID, release, nil
}

func (s *Store) PutObject(ctx context.Context, filename string, r io.ReadSeeker, size int64, expectedSHA256 [32]byte) (blobstore.PutResult, error) {
	filename = strings.TrimSpace(filename)
	if filename == "" || size <= 0 || r == nil {
		return blobstore.PutResult{}, blobstore.ErrInvalidChunk
	}

	excluded := make([]string, 0, s.scheduler.Len())
	var lastErr error

	for len(excluded) < s.scheduler.Len() {
		botUserID, release, err := s.AcquireUploadBotFor(
			ctx,
			excluded,
			blobstore.LeaseMetadata{
				Operation: blobstore.LeaseOperationUpload,
				FileName:  filename,
				SizeBytes: size,
			},
		)
		if err != nil {
			if lastErr != nil {
				return blobstore.PutResult{}, lastErr
			}
			return blobstore.PutResult{}, err
		}

		if _, err := r.Seek(0, io.SeekStart); err != nil {
			release()
			return blobstore.PutResult{}, err
		}

		put, err := s.putAttachmentWithBot(ctx, botUserID, filename, r, size, expectedSHA256)
		release()
		if err == nil {
			return put, nil
		}

		lastErr = err
		excluded = append(excluded, botUserID)

		_, retryable := blobstore.Classify(err)
		if !retryable {
			return blobstore.PutResult{}, err
		}
	}

	if lastErr != nil {
		return blobstore.PutResult{}, lastErr
	}

	return blobstore.PutResult{}, blobstore.ErrNoUsableBot
}

func (s *Store) ResolveAttachmentURL(ctx context.Context, location blobstore.Location) (string, time.Time, error) {
	if location.DiscordChannelID == "" ||
		location.DiscordMessageID == "" ||
		location.DiscordAttachmentID == "" ||
		location.DiscordChannelID != s.channelID {
		return "", time.Time{}, blobstore.ErrInvalidChunk
	}

	excluded := make([]string, 0, s.scheduler.Len())
	var lastErr error

	for len(excluded) < s.scheduler.Len() {
		if err := ctx.Err(); err != nil {
			return "", time.Time{}, classifyError("", err)
		}

		bot, release, err := s.scheduler.Acquire(
			ctx,
			excluded,
			blobstore.LeaseMetadata{
				Operation:  blobstore.LeaseOperationResolve,
				ResourceID: location.DiscordMessageID,
			},
		)
		if err != nil {
			if lastErr != nil {
				return "", time.Time{}, lastErr
			}
			return "", time.Time{}, err
		}

		excluded = append(excluded, bot.UserID)

		message, err := s.client.GetMessage(
			ctx,
			bot.Token,
			location.DiscordChannelID,
			location.DiscordMessageID,
		)
		if err != nil {
			classified := classifyError(bot.UserID, err)
			s.scheduler.RecordFailure(bot.UserID, classified)
			s.applyCooldown(bot.UserID, classified)
			release()
			lastErr = classified
			continue
		}

		found := false
		for _, attachment := range message.Attachments {
			if attachment.ID != location.DiscordAttachmentID || strings.TrimSpace(attachment.URL) == "" {
				continue
			}

			found = true
			s.scheduler.RecordSuccess(bot.UserID, 0)
			release()
			return attachment.URL, attachmentURLExpiry(attachment.URL), nil
		}

		if !found {
			protocolErr := &UpstreamError{
				Class:     ErrorProtocol,
				BotUserID: bot.UserID,
				Retryable: false,
				Cause:     errors.New("Discord attachment not present in message response"),
			}
			s.scheduler.RecordFailure(bot.UserID, protocolErr)
			release()
			lastErr = protocolErr
		}
	}

	if lastErr != nil {
		return "", time.Time{}, lastErr
	}

	return "", time.Time{}, blobstore.ErrNoUsableBot
}

func (s *Store) DeleteObject(ctx context.Context, location blobstore.Location) error {
	return s.DeleteChunk(ctx, location)
}

func attachmentURLExpiry(rawURL string) time.Time {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return time.Time{}
	}

	raw := strings.TrimSpace(parsed.Query().Get("ex"))
	if raw == "" {
		return time.Time{}
	}

	seconds, err := strconv.ParseInt(raw, 16, 64)
	if err != nil || seconds <= 0 {
		return time.Time{}
	}

	return time.Unix(seconds, 0).UTC()
}
