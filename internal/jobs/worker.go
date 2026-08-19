package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultPollInterval = time.Second

type Handler func(context.Context, Job) error

type PermanentError struct {
	Err error
}

func (e *PermanentError) Error() string {
	return e.Err.Error()
}

func (e *PermanentError) Unwrap() error {
	return e.Err
}

func Permanent(err error) error {
	if err == nil {
		return nil
	}
	return &PermanentError{Err: err}
}

type Worker struct {
	pool     *pgxpool.Pool
	logger   *slog.Logger
	handlers map[string]Handler
}

func NewWorker(pool *pgxpool.Pool, logger *slog.Logger, handlers map[string]Handler) *Worker {
	if logger == nil {
		logger = slog.Default()
	}
	return &Worker{pool: pool, logger: logger, handlers: handlers}
}

func (w *Worker) Run(ctx context.Context, workerID string) {
	logger := w.logger.With("worker_id", workerID)

	for {
		job, err := Claim(ctx, w.pool, workerID)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			logger.Error("claim job failed", "error", err)
			if !wait(ctx, defaultPollInterval) {
				return
			}
			continue
		}

		if job == nil {
			if !wait(ctx, defaultPollInterval) {
				return
			}
			continue
		}

		w.runJob(ctx, workerID, *job, logger)
	}
}

func (w *Worker) runJob(ctx context.Context, workerID string, job Job, logger *slog.Logger) {
	handler, ok := w.handlers[job.Type]
	if !ok {
		err := fmt.Errorf("unsupported job type %q", job.Type)
		if finishErr := Fail(ctx, w.pool, job.ID, workerID, err); finishErr != nil {
			logger.Error("fail unsupported job failed", "job_id", job.ID, "error", finishErr)
		}
		return
	}

	err := handler(ctx, job)
	if err == nil {
		if err := Complete(ctx, w.pool, job.ID, workerID); err != nil && ctx.Err() == nil {
			logger.Error("complete job failed", "job_id", job.ID, "type", job.Type, "error", err)
		}
		return
	}

	var permanent *PermanentError
	if errors.As(err, &permanent) {
		if finishErr := Fail(ctx, w.pool, job.ID, workerID, err); finishErr != nil && ctx.Err() == nil {
			logger.Error("fail job failed", "job_id", job.ID, "type", job.Type, "error", finishErr)
		}
		return
	}

	runAt := time.Now().UTC().Add(retryDelay(job.Attempts))
	if retryErr := Retry(ctx, w.pool, job.ID, workerID, runAt, err); retryErr != nil && ctx.Err() == nil {
		logger.Error("retry job failed", "job_id", job.ID, "type", job.Type, "error", retryErr)
		return
	}

	logger.Warn(
		"job scheduled for retry",
		"job_id", job.ID,
		"type", job.Type,
		"attempt", job.Attempts,
		"max_attempts", job.MaxAttempts,
		"error", err,
	)
}

func retryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 6 {
		attempt = 6
	}
	return time.Second << (attempt - 1)
}

func wait(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
