package app

import (
	"context"
	"errors"
	"testing"
)

type fakeReadyDatabase struct {
	err error
}

func (f fakeReadyDatabase) Ping(context.Context) error {
	return f.err
}

type fakeReadyStorage struct {
	count int
}

func (f fakeReadyStorage) BotCount() int {
	return f.count
}

func TestReadinessCheck(t *testing.T) {
	check := readinessCheck(
		fakeReadyDatabase{},
		fakeReadyStorage{count: 2},
	)

	if err := check(context.Background()); err != nil {
		t.Fatalf("readiness = %v", err)
	}
}

func TestReadinessCheckRejectsDatabaseFailure(t *testing.T) {
	check := readinessCheck(
		fakeReadyDatabase{err: errors.New("database down")},
		fakeReadyStorage{count: 1},
	)

	if err := check(context.Background()); err == nil {
		t.Fatal("readiness accepted failed database")
	}
}

func TestReadinessCheckRejectsNoStorageBots(t *testing.T) {
	check := readinessCheck(
		fakeReadyDatabase{},
		fakeReadyStorage{},
	)

	if err := check(context.Background()); err == nil {
		t.Fatal("readiness accepted zero storage bots")
	}
}
