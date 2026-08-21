package discordstore

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

type Store struct {
	channelID string
	client    *Client
	scheduler *Scheduler
}

type chunkBodyResult struct {
	err       error
	invariant error
}

func New(ctx context.Context, channelID string, tokens []string, httpClient *http.Client) (*Store, error) {
	return NewWithClient(ctx, channelID, tokens, NewClient(httpClient))
}

func NewWithClient(ctx context.Context, channelID string, tokens []string, client *Client) (*Store, error) {
	if channelID == "" {
		return nil, errors.New("Discord channel ID is required")
	}

	bots, err := ResolveBots(ctx, client, tokens)
	if err != nil {
		return nil, err
	}

	return &Store{
		channelID: channelID,
		client:    client,
		scheduler: NewScheduler(bots),
	}, nil
}

func (s *Store) BotCount() int {
	return s.scheduler.Len()
}

func (s *Store) SelectUploadBot(excludedBotUserIDs []string) (string, error) {
	bot, err := s.scheduler.Next(excludedBotUserIDs)
	if err != nil {
		return "", err
	}
	return bot.UserID, nil
}

func (s *Store) PutChunk(ctx context.Context, excluded []string, r io.Reader, size int64, expectedSHA256 [32]byte) (blobstore.PutResult, error) {
	botUserID, release, err := s.AcquireUploadBot(ctx, excluded)
	if err != nil {
		return blobstore.PutResult{}, err
	}
	defer release()

	return s.PutChunkWithBot(ctx, botUserID, r, size, expectedSHA256)
}

func (s *Store) PutChunkWithBot(ctx context.Context, botUserID string, r io.Reader, size int64, expectedSHA256 [32]byte) (blobstore.PutResult, error) {
	if size <= 0 {
		return blobstore.PutResult{}, blobstore.ErrInvalidChunk
	}

	filename := hex.EncodeToString(expectedSHA256[:]) + ".chunk"
	return s.putAttachmentWithBot(ctx, botUserID, filename, r, size, expectedSHA256)
}

func (s *Store) putAttachmentWithBot(
	ctx context.Context,
	botUserID string,
	filename string,
	r io.Reader,
	size int64,
	expectedSHA256 [32]byte,
) (blobstore.PutResult, error) {
	if r == nil || size <= 0 || filename == "" {
		return blobstore.PutResult{}, blobstore.ErrInvalidChunk
	}

	bot, ok := s.scheduler.Get(botUserID)
	if !ok {
		return blobstore.PutResult{}, fmt.Errorf("%w: %s", blobstore.ErrNoUsableBot, botUserID)
	}

	reader, writer := io.Pipe()
	multipartWriter := multipart.NewWriter(writer)
	contentType := multipartWriter.FormDataContentType()
	bodyResult := make(chan chunkBodyResult, 1)

	go writeAttachmentMultipart(
		writer,
		multipartWriter,
		r,
		size,
		expectedSHA256,
		filename,
		bodyResult,
	)

	message, requestErr := s.client.CreateMessage(
		ctx,
		bot.Token,
		s.channelID,
		contentType,
		reader,
	)
	_ = reader.CloseWithError(requestErr)
	result := <-bodyResult

	if result.invariant != nil {
		return blobstore.PutResult{}, fmt.Errorf(
			"%w: %v",
			blobstore.ErrInvalidChunk,
			result.invariant,
		)
	}

	if requestErr != nil {
		classified := classifyError(bot.UserID, requestErr)
		s.scheduler.RecordFailure(bot.UserID, classified)
		s.applyCooldown(bot.UserID, classified)
		return blobstore.PutResult{}, classified
	}

	if result.err != nil {
		return blobstore.PutResult{}, fmt.Errorf(
			"stream Discord attachment: %w",
			result.err,
		)
	}

	if message.ID == "" ||
		message.ChannelID != s.channelID ||
		len(message.Attachments) != 1 {
		protocolErr := &UpstreamError{
			Class:     ErrorProtocol,
			BotUserID: bot.UserID,
			Retryable: false,
			Cause:     errors.New("invalid Discord message response"),
		}
		s.scheduler.RecordFailure(bot.UserID, protocolErr)
		return blobstore.PutResult{}, protocolErr
	}

	attachment := message.Attachments[0]
	if attachment.ID == "" || attachment.Size != size {
		protocolErr := &UpstreamError{
			Class:     ErrorProtocol,
			BotUserID: bot.UserID,
			Retryable: false,
			Cause:     errors.New("invalid Discord attachment response"),
		}
		s.scheduler.RecordFailure(bot.UserID, protocolErr)
		return blobstore.PutResult{}, protocolErr
	}

	s.scheduler.RecordSuccess(bot.UserID, size)

	return blobstore.PutResult{
		BotUserID:              bot.UserID,
		AttachmentURL:          strings.TrimSpace(attachment.URL),
		AttachmentURLExpiresAt: attachmentURLExpiry(attachment.URL),
		Location: blobstore.Location{
			DiscordChannelID:    message.ChannelID,
			DiscordMessageID:    message.ID,
			DiscordAttachmentID: attachment.ID,
		},
	}, nil
}

func (s *Store) OpenChunk(
	ctx context.Context,
	location blobstore.ChunkLocation,
	offset int64,
	length int64,
) (io.ReadCloser, error) {
	if offset < 0 ||
		length < 0 ||
		(length > 0 && offset > math.MaxInt64-(length-1)) {
		return nil, blobstore.ErrInvalidChunk
	}

	attachmentURL, _, err := s.ResolveAttachmentURL(ctx, location)
	if err != nil {
		return nil, err
	}

	rangeHeader := chunkRange(offset, length)
	resp, err := s.client.OpenAttachment(ctx, attachmentURL, rangeHeader)
	if err != nil {
		return nil, classifyError("", err)
	}

	if rangeHeader != "" && resp.StatusCode != http.StatusPartialContent {
		resp.Body.Close()
		return nil, &UpstreamError{
			Class:     ErrorProtocol,
			Retryable: false,
			Cause:     fmt.Errorf("range request returned HTTP %d", resp.StatusCode),
		}
	}

	return resp.Body, nil
}

func (s *Store) applyCooldown(botUserID string, err error) {
	var upstream *UpstreamError
	if !errors.As(err, &upstream) ||
		upstream.Class != ErrorRateLimited {
		return
	}

	duration := upstream.RetryAfter
	if duration <= 0 {
		duration = time.Second
	}

	s.scheduler.Cooldown(botUserID, duration)
}

func writeAttachmentMultipart(
	writer *io.PipeWriter,
	multipartWriter *multipart.Writer,
	source io.Reader,
	size int64,
	expectedSHA256 [32]byte,
	filename string,
	result chan<- chunkBodyResult,
) {
	var outcome chunkBodyResult

	defer func() {
		if err := multipartWriter.Close(); err != nil &&
			outcome.err == nil &&
			outcome.invariant == nil {
			outcome.err = err
		}

		switch {
		case outcome.invariant != nil:
			_ = writer.CloseWithError(outcome.invariant)
		case outcome.err != nil:
			_ = writer.CloseWithError(outcome.err)
		default:
			_ = writer.Close()
		}

		result <- outcome
	}()

	payload, err := json.Marshal(struct {
		Attachments []struct {
			ID       int    `json:"id"`
			Filename string `json:"filename"`
		} `json:"attachments"`
	}{
		Attachments: []struct {
			ID       int    `json:"id"`
			Filename string `json:"filename"`
		}{
			{ID: 0, Filename: filename},
		},
	})
	if err != nil {
		outcome.err = err
		return
	}

	if err := multipartWriter.WriteField(
		"payload_json",
		string(payload),
	); err != nil {
		outcome.err = err
		return
	}

	part, err := multipartWriter.CreateFormFile(
		"files[0]",
		filename,
	)
	if err != nil {
		outcome.err = err
		return
	}

	hash := sha256.New()
	n, err := io.CopyN(
		part,
		io.TeeReader(source, hash),
		size,
	)
	if err != nil {
		if errors.Is(err, io.EOF) ||
			errors.Is(err, io.ErrUnexpectedEOF) {
			outcome.invariant = fmt.Errorf(
				"attachment size = %d, expected %d",
				n,
				size,
			)
		} else {
			outcome.err = err
		}
		return
	}

	var extra [1]byte
	extraN, extraErr := io.ReadFull(source, extra[:])

	if extraN > 0 {
		outcome.invariant = fmt.Errorf(
			"attachment exceeds expected size %d",
			size,
		)
		return
	}

	if extraErr != nil &&
		!errors.Is(extraErr, io.EOF) &&
		!errors.Is(extraErr, io.ErrUnexpectedEOF) {
		outcome.err = extraErr
		return
	}

	var actualSHA256 [32]byte
	copy(actualSHA256[:], hash.Sum(nil))

	if actualSHA256 != expectedSHA256 {
		outcome.invariant = errors.New(
			"attachment SHA-256 mismatch",
		)
	}
}

func chunkRange(offset, length int64) string {
	if offset == 0 && length == 0 {
		return ""
	}

	if length == 0 {
		return fmt.Sprintf("bytes=%d-", offset)
	}

	return fmt.Sprintf(
		"bytes=%d-%d",
		offset,
		offset+length-1,
	)
}
