package search

import (
	"errors"
	"testing"
	"time"
)

func TestNormalizeInputDefaults(t *testing.T) {
	input := Input{Query: " report ", Limit: 50}

	if err := normalizeInput(Actor{}, &input); err != nil {
		t.Fatalf("normalizeInput(): %v", err)
	}
	if input.Query != "report" {
		t.Fatalf("query = %q", input.Query)
	}
	if input.State != StateActive {
		t.Fatalf("state = %q", input.State)
	}
	if input.Sort != SortRelevance {
		t.Fatalf("sort = %q", input.Sort)
	}
	if input.Order != OrderDesc {
		t.Fatalf("order = %q", input.Order)
	}
}

func TestNormalizeInputRejectsMismatchedCursor(t *testing.T) {
	for _, input := range []Input{
		{Sort: SortName, Limit: 50, AfterID: "01900000-0000-7000-8000-000000000001"},
		{Sort: SortName, Limit: 50, AfterKey: "report"},
	} {
		if err := normalizeInput(Actor{}, &input); !errors.Is(err, ErrInvalidCursor) {
			t.Fatalf("normalizeInput(%+v) = %v", input, err)
		}
	}
}

func TestNormalizeInputRejectsInvalidRanges(t *testing.T) {
	now := time.Now()
	earlier := now.Add(-time.Hour)
	minSize, maxSize := int64(20), int64(10)

	tests := []Input{
		{Limit: 50, MinSize: &minSize, MaxSize: &maxSize},
		{Limit: 50, CreatedFrom: &now, CreatedTo: &earlier},
		{Limit: 50, UpdatedFrom: &now, UpdatedTo: &earlier},
	}

	for _, input := range tests {
		if err := normalizeInput(Actor{}, &input); !errors.Is(err, ErrInvalidQuery) {
			t.Fatalf("normalizeInput(%+v) = %v", input, err)
		}
	}
}

func TestNormalizeInputRestrictsAdminFilters(t *testing.T) {
	for _, input := range []Input{
		{Limit: 50, State: StateTrash},
		{Limit: 50, OwnerID: "01900000-0000-7000-8000-000000000001"},
	} {
		if err := normalizeInput(Actor{}, &input); !errors.Is(err, ErrForbidden) {
			t.Fatalf("normalizeInput(%+v) = %v", input, err)
		}
	}

	input := Input{
		Limit:   50,
		State:   StateTrash,
		OwnerID: "01900000-0000-7000-8000-000000000001",
	}
	if err := normalizeInput(Actor{Admin: true}, &input); err != nil {
		t.Fatalf("admin normalizeInput(): %v", err)
	}
}
