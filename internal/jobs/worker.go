package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultPollInterval      = time.Second
	defaultLeaseTimeout      = 5 * time.Minute
	defaultHeartbeatInterval = time.Minute
	defaultRecoveryInterval  = time.Minute
	finishTimeout            = 5 * time.Second
)

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
	nextRecovery := time.Time{}

	for {
		if ctx.Err() != nil {
			return
		}

		now := time.Now()
		if !now.Before(nextRecovery) {
			count, err := RecoverStale(ctx, w.pool, defaultLeaseTimeout)
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				logger.Error("recover stale jobs failed", "error", err)
			} else if count > 0 {
				logger.Warn("recovered stale jobs", "count", count)
			}
			nextRecovery = now.Add(defaultRecoveryInterval)
		}

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
		finishCtx, cancel := finishContext(ctx)
		defer cancel()
		if finishErr := Fail(finishCtx, w.pool, job.ID, workerID, err); finishErr != nil {
			logger.Error("fail unsupported job failed", "job_id", job.ID, "error", finishErr)
		}
		return
	}

	jobCtx, cancelJob := context.WithCancel(ctx)
	heartbeatDone := make(chan struct{})
	go w.heartbeat(jobCtx, cancelJob, workerID, job, logger, heartbeatDone)

	err := handler(jobCtx, job)
	cancelJob()
	<-heartbeatDone

	finishCtx, cancelFinish := finishContext(ctx)
	defer cancelFinish()

	if err == nil {
		if err := Complete(finishCtx, w.pool, job.ID, workerID); err != nil {
			logger.Error("complete job failed", "job_id", job.ID, "type", job.Type, "error", err)
		}
		return
	}

	var permanent *PermanentError
	if errors.As(err, &permanent) {
		if finishErr := Fail(finishCtx, w.pool, job.ID, workerID, err); finishErr != nil {
			logger.Error("fail job failed", "job_id", job.ID, "type", job.Type, "error", finishErr)
		}
		return
	}

	runAt := time.Now().UTC().Add(retryDelay(job.Attempts))
	if ctx.Err() != nil {
		runAt = time.Now().UTC()
	}

	if retryErr := Retry(finishCtx, w.pool, job.ID, workerID, runAt, err); retryErr != nil {
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

func (w *Worker) heartbeat(ctx context.Context, cancel context.CancelFunc, workerID string, job Job, logger *slog.Logger, done chan<- struct{}) {
	defer close(done)

	ticker := time.NewTicker(defaultHeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			err := Touch(ctx, w.pool, job.ID, workerID)
			if errors.Is(err, ErrLeaseLost) {
				logger.Error("job lease lost", "job_id", job.ID, "type", job.Type)
				cancel()
				return
			}
			if err != nil {
				logger.Warn("refresh job lease failed", "job_id", job.ID, "type", job.Type, "error", err)
			}
		}
	}
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

func finishContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx.Err() == nil {
		return context.WithCancel(ctx)
	}
	return context.WithTimeout(context.Background(), finishTimeout)
}
