package jobs

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

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
