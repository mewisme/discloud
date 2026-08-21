package discordstore

import (
	"errors"
	"testing"
)

func TestSchedulerAddBot(t *testing.T) {
	scheduler := NewScheduler(nil)

	if err := scheduler.AddBot(Bot{UserID: "1", Username: "bot", DisplayName: "Bot", Token: "token"}); err != nil {
		t.Fatalf("AddBot(): %v", err)
	}

	if got := scheduler.Len(); got != 1 {
		t.Fatalf("Len() = %d, want 1", got)
	}
	if got := scheduler.Capacity().Effective; got != 1 {
		t.Fatalf("effective capacity = %d, want 1", got)
	}
}

func TestSchedulerAddBotRejectsDuplicateIdentity(t *testing.T) {
	scheduler := NewScheduler([]Bot{{UserID: "1", Token: "token-a"}})

	err := scheduler.AddBot(Bot{UserID: "1", Token: "token-b"})
	if !errors.Is(err, ErrDuplicateBotUser) {
		t.Fatalf("AddBot() = %v, want ErrDuplicateBotUser", err)
	}
}
