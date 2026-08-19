package uploads

import (
	"context"
	"log/slog"
	"time"
)

const (
	expiryInterval  = time.Minute
	expiryBatchSize = 100
)

func RunExpiryWorker(ctx context.Context, service *Service, logger *slog.Logger) {
	ticker := time.NewTicker(expiryInterval)
	defer ticker.Stop()

	for {
		count, err := service.Expire(ctx, expiryBatchSize)
		if err != nil && ctx.Err() == nil {
			logger.Error("upload expiry failed", "error", err)
		} else if count > 0 {
			logger.Info("expired upload sessions", "count", count)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
