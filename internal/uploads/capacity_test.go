package uploads

import (
	"testing"

	"github.com/mewisme/discloud/internal/blobstore/fake"
)

type partConcurrencyTestStore struct {
	*fake.Store
	recommended int
}

func (s *partConcurrencyTestStore) RecommendedPartConcurrency() int {
	return s.recommended
}

func TestRecommendedPartConcurrency(t *testing.T) {
	tests := []struct {
		name        string
		recommended int
		want        int
	}{
		{name: "minimum", recommended: 0, want: minPartConcurrency},
		{name: "within limit", recommended: 4, want: 4},
		{name: "backend ceiling", recommended: maxPartConcurrency + 10, want: maxPartConcurrency},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &partConcurrencyTestStore{
				Store:       fake.New("bot-a"),
				recommended: tt.recommended,
			}
			uploader := NewPartUploader(nil, store)

			if got := uploader.RecommendedPartConcurrency(); got != tt.want {
				t.Fatalf("RecommendedPartConcurrency() = %d, want %d", got, tt.want)
			}
		})
	}

	uploader := NewPartUploader(nil, fake.New("bot-a"))
	if got := uploader.RecommendedPartConcurrency(); got != minPartConcurrency {
		t.Fatalf("RecommendedPartConcurrency() without provider = %d, want %d", got, minPartConcurrency)
	}
}

func TestPartUploadCapacityRejectsWhenFull(t *testing.T) {
	uploader := NewPartUploader(nil, fake.New("bot-a"))

	for index := range maxPartConcurrency {
		if !uploader.tryAcquirePartSlot() {
			t.Fatalf("slot %d was rejected before capacity was full", index)
		}
	}

	if uploader.tryAcquirePartSlot() {
		t.Fatal("capacity allowed a part beyond the hard ceiling")
	}

	uploader.releasePartSlot()

	if !uploader.tryAcquirePartSlot() {
		t.Fatal("released capacity was not reusable")
	}

	for range maxPartConcurrency {
		uploader.releasePartSlot()
	}
}
