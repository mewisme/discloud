package app

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"
)

const managedShutdownFileEnv = "DISCLOUD_MANAGED_SHUTDOWN_FILE"

func managedShutdownContext(parent context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(parent)
	path := strings.TrimSpace(os.Getenv(managedShutdownFileEnv))
	if path == "" {
		return ctx, cancel
	}
	go watchManagedShutdownFile(ctx, cancel, path)
	return ctx, cancel
}

func watchManagedShutdownFile(ctx context.Context, cancel context.CancelFunc, path string) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, err := os.Stat(path)
			switch {
			case err == nil:
				_ = os.Remove(path)
				cancel()
				return
			case errors.Is(err, os.ErrNotExist):
				continue
			default:
				continue
			}
		}
	}
}
