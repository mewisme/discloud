package discordstore

import (
	"context"
	"errors"
	"fmt"
	"net"
	"time"
)

type ErrorClass string

const (
	ErrorCanceled    ErrorClass = "canceled"
	ErrorTimeout     ErrorClass = "timeout"
	ErrorRateLimited ErrorClass = "rate_limited"
	ErrorUnavailable ErrorClass = "unavailable"
	ErrorAuth        ErrorClass = "auth"
	ErrorRequest     ErrorClass = "request"
	ErrorProtocol    ErrorClass = "protocol"
)

type APIError struct {
	StatusCode int
	RetryAfter time.Duration
	Global     bool
	Message    string
}

func (e *APIError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("Discord API returned HTTP %d", e.StatusCode)
	}
	return fmt.Sprintf("Discord API returned HTTP %d: %s", e.StatusCode, e.Message)
}

type UpstreamError struct {
	Class      ErrorClass
	BotUserID  string
	StatusCode int
	RetryAfter time.Duration
	Retryable  bool
	Cause      error
}

func (e *UpstreamError) Error() string {
	if e.BotUserID == "" {
		return fmt.Sprintf("Discord %s error: %v", e.Class, e.Cause)
	}
	return fmt.Sprintf("Discord bot %s %s error: %v", e.BotUserID, e.Class, e.Cause)
}

func (e *UpstreamError) Unwrap() error {
	return e.Cause
}

func IsRetryable(err error) bool {
	var upstream *UpstreamError
	return errors.As(err, &upstream) && upstream.Retryable
}

func classifyError(botUserID string, err error) error {
	if err == nil {
		return nil
	}

	if errors.Is(err, context.Canceled) {
		return &UpstreamError{
			Class:     ErrorCanceled,
			BotUserID: botUserID,
			Retryable: false,
			Cause:     err,
		}
	}

	if errors.Is(err, context.DeadlineExceeded) {
		return &UpstreamError{
			Class:     ErrorTimeout,
			BotUserID: botUserID,
			Retryable: true,
			Cause:     err,
		}
	}

	var apiErr *APIError
	if errors.As(err, &apiErr) {
		upstream := &UpstreamError{
			BotUserID:  botUserID,
			StatusCode: apiErr.StatusCode,
			RetryAfter: apiErr.RetryAfter,
			Cause:      err,
		}

		switch {
		case apiErr.StatusCode == 429:
			upstream.Class = ErrorRateLimited
			upstream.Retryable = true
		case apiErr.StatusCode == 408:
			upstream.Class = ErrorTimeout
			upstream.Retryable = true
		case apiErr.StatusCode >= 500:
			upstream.Class = ErrorUnavailable
			upstream.Retryable = true
		case apiErr.StatusCode == 401 || apiErr.StatusCode == 403:
			upstream.Class = ErrorAuth
		default:
			upstream.Class = ErrorRequest
		}

		return upstream
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		if netErr.Timeout() {
			return &UpstreamError{
				Class:     ErrorTimeout,
				BotUserID: botUserID,
				Retryable: true,
				Cause:     err,
			}
		}

		return &UpstreamError{
			Class:     ErrorUnavailable,
			BotUserID: botUserID,
			Retryable: true,
			Cause:     err,
		}
	}

	return &UpstreamError{
		Class:     ErrorUnavailable,
		BotUserID: botUserID,
		Retryable: true,
		Cause:     err,
	}
}
