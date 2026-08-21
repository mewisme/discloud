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
	capacity int
}

func (f fakeReadyStorage) EffectiveCapacity() int {
	return f.capacity
}

func TestReadinessCheck(t *testing.T) {
	check := readinessCheck(fakeReadyDatabase{}, fakeReadyStorage{capacity: 2})
	if err := check(context.Background()); err != nil {
		t.Fatalf("readiness = %v", err)
	}
}

func TestReadinessCheckAcceptsDegradedBotPool(t *testing.T) {
	check := readinessCheck(fakeReadyDatabase{}, fakeReadyStorage{capacity: 1})
	if err := check(context.Background()); err != nil {
		t.Fatalf("readiness rejected degraded storage: %v", err)
	}
}

func TestReadinessCheckRejectsDatabaseFailure(t *testing.T) {
	check := readinessCheck(fakeReadyDatabase{err: errors.New("database down")}, fakeReadyStorage{capacity: 1})
	if err := check(context.Background()); err == nil {
		t.Fatal("readiness accepted failed database")
	}
}

func TestReadinessCheckRejectsZeroEffectiveCapacity(t *testing.T) {
	check := readinessCheck(fakeReadyDatabase{}, fakeReadyStorage{})
	if err := check(context.Background()); err == nil {
		t.Fatal("readiness accepted zero effective Discord capacity")
	}
}

func TestReadinessCheckRejectsMissingStorage(t *testing.T) {
	check := readinessCheck(fakeReadyDatabase{}, nil)
	if err := check(context.Background()); err == nil {
		t.Fatal("readiness accepted missing storage")
	}
}
