package uploads

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestChunkUploadAttemptsIntegration(t *testing.T) {
	ctx, pool := openUploadTestPool(t)

	userID, rootID := createUploadUser(
		t,
		ctx,
		pool,
		"attempt-owner",
		nil,
	)

	service := New(pool, 10, time.Hour)

	session, err := service.Create(
		ctx,
		Actor{UserID: userID},
		CreateInput{
			ParentFolderID: rootID,
			Name:           "large.bin",
			SizeBytes:      50,
		},
	)
	if err != nil {
		t.Fatalf("create upload: %v", err)
	}

	first, err := service.StartAttempt(
		ctx,
		session.ID,
		0,
		"bot-a",
	)
	if err != nil {
		t.Fatalf("start first attempt: %v", err)
	}

	if first.AttemptNumber != 1 {
		t.Fatalf(
			"attempt = %d, want 1",
			first.AttemptNumber,
		)
	}

	if err := service.FinishAttempt(
		ctx,
		first.ID,
		AttemptFailed,
		"timeout",
		"upstream timeout",
	); err != nil {
		t.Fatalf("finish first attempt: %v", err)
	}

	if err := service.FinishAttempt(
		ctx,
		first.ID,
		AttemptFailed,
		"timeout",
		"upstream timeout",
	); err != nil {
		t.Fatalf(
			"idempotent finish first attempt: %v",
			err,
		)
	}

	_, err = service.StartAttempt(
		ctx,
		session.ID,
		0,
		"bot-a",
	)
	if !errors.Is(err, ErrBotAlreadyTried) {
		t.Fatalf("reused bot = %v", err)
	}

	for i, bot := range []string{
		"bot-b",
		"bot-c",
		"bot-d",
		"bot-e",
	} {
		attempt, err := service.StartAttempt(
			ctx,
			session.ID,
			0,
			bot,
		)
		if err != nil {
			t.Fatalf(
				"start %s: %v",
				bot,
				err,
			)
		}

		if attempt.AttemptNumber != i+2 {
			t.Fatalf(
				"%s attempt = %d, want %d",
				bot,
				attempt.AttemptNumber,
				i+2,
			)
		}

		if err := service.FinishAttempt(
			ctx,
			attempt.ID,
			AttemptFailed,
			"unavailable",
			"temporary upstream failure",
		); err != nil {
			t.Fatalf(
				"finish %s: %v",
				bot,
				err,
			)
		}
	}

	_, err = service.StartAttempt(
		ctx,
		session.ID,
		0,
		"bot-f",
	)
	if !errors.Is(err, ErrAttemptsExhausted) {
		t.Fatalf(
			"sixth attempt = %v",
			err,
		)
	}

	bots, err := service.UsedBotIDs(
		context.Background(),
		session.ID,
		0,
	)
	if err != nil {
		t.Fatalf("used bots: %v", err)
	}

	want := []string{
		"bot-a",
		"bot-b",
		"bot-c",
		"bot-d",
		"bot-e",
	}

	if len(bots) != len(want) {
		t.Fatalf(
			"bots = %v, want %v",
			bots,
			want,
		)
	}

	for i := range want {
		if bots[i] != want[i] {
			t.Fatalf(
				"bots = %v, want %v",
				bots,
				want,
			)
		}
	}

	_, err = service.StartAttempt(
		ctx,
		session.ID,
		5,
		"bot-z",
	)
	if !errors.Is(err, ErrInvalidPart) {
		t.Fatalf(
			"out-of-range part = %v",
			err,
		)
	}
}
