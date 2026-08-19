package app

import (
	"context"
	"errors"
	"fmt"
)

type readinessDatabase interface {
	Ping(context.Context) error
}

type readinessStorage interface {
	BotCount() int
}

func readinessCheck(database readinessDatabase, storage readinessStorage) func(context.Context) error {
	return func(ctx context.Context) error {
		if database == nil {
			return errors.New("database is unavailable")
		}
		if storage == nil {
			return errors.New("storage is unavailable")
		}
		if err := database.Ping(ctx); err != nil {
			return fmt.Errorf("database readiness: %w", err)
		}
		if storage.BotCount() < 1 {
			return errors.New("storage has no usable Discord bots")
		}
		return nil
	}
}
