package jobs

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrLeaseLost = errors.New("job lease lost")

type Job struct {
	ID          string
	Type        string
	Payload     []byte
	Attempts    int
	MaxAttempts int
}

func Claim(ctx context.Context, pool *pgxpool.Pool, workerID string) (*Job, error) {
	if strings.TrimSpace(workerID) == "" {
		return nil, errors.New("worker ID is required")
	}

	var job Job
	err := pool.QueryRow(ctx, `
		WITH candidate AS (
			SELECT id
			FROM jobs
			WHERE status = 'queued'
			  AND run_at <= now()
			  AND attempts < max_attempts
			ORDER BY priority DESC, run_at, created_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE jobs j
		SET status = 'running',
		    attempts = attempts + 1,
		    locked_at = now(),
		    locked_by = $1,
		    updated_at = now()
		FROM candidate
		WHERE j.id = candidate.id
		RETURNING j.id::text, j.type, j.payload, j.attempts, j.max_attempts
	`, workerID).Scan(&job.ID, &job.Type, &job.Payload, &job.Attempts, &job.MaxAttempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim job: %w", err)
	}
	return &job, nil
}

func Complete(ctx context.Context, pool *pgxpool.Pool, jobID, workerID string) error {
	tag, err := pool.Exec(ctx, `
		UPDATE jobs
		SET status = 'completed',
		    locked_at = NULL,
		    locked_by = NULL,
		    completed_at = now(),
		    updated_at = now()
		WHERE id = $1::uuid
		  AND status = 'running'
		  AND locked_by = $2
	`, jobID, workerID)
	if err != nil {
		return fmt.Errorf("complete job: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

func Fail(ctx context.Context, pool *pgxpool.Pool, jobID, workerID string, cause error) error {
	tag, err := pool.Exec(ctx, `
		UPDATE jobs
		SET status = 'failed',
		    locked_at = NULL,
		    locked_by = NULL,
		    last_error = $3,
		    updated_at = now()
		WHERE id = $1::uuid
		  AND status = 'running'
		  AND locked_by = $2
	`, jobID, workerID, errorText(cause))
	if err != nil {
		return fmt.Errorf("fail job: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

func Retry(ctx context.Context, pool *pgxpool.Pool, jobID, workerID string, runAt time.Time, cause error) error {
	tag, err := pool.Exec(ctx, `
		UPDATE jobs
		SET status = CASE
				WHEN attempts >= max_attempts THEN 'dead'
				ELSE 'queued'
		    END,
		    run_at = CASE
				WHEN attempts >= max_attempts THEN run_at
				ELSE $3
		    END,
		    locked_at = NULL,
		    locked_by = NULL,
		    last_error = $4,
		    updated_at = now()
		WHERE id = $1::uuid
		  AND status = 'running'
		  AND locked_by = $2
	`, jobID, workerID, runAt, errorText(cause))
	if err != nil {
		return fmt.Errorf("retry job: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	value := []rune(strings.TrimSpace(err.Error()))
	if len(value) > 2000 {
		value = value[:2000]
	}
	return string(value)
}
