package adminops

import (
	"context"
	"fmt"
)

func (s *Service) ListJobs(ctx context.Context, query JobQuery) ([]JobDiagnostic, bool, error) {
	if !validPage(query.Limit, query.BeforeAt, query.BeforeID) || !validJobStatus(query.Status) {
		return nil, false, ErrInvalidQuery
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			id::text,
			type,
			status,
			payload,
			priority,
			attempts,
			max_attempts,
			run_at,
			locked_at,
			COALESCE(locked_by, ''),
			COALESCE(last_error, ''),
			created_at,
			updated_at,
			completed_at
		FROM jobs
		WHERE ($1 = '' OR status = $1)
		  AND ($2 = '' OR type = $2)
		  AND (
				$3::timestamptz IS NULL
				OR (updated_at, id) < ($3, NULLIF($4, '')::uuid)
		  )
		ORDER BY updated_at DESC, id DESC
		LIMIT $5
	`, query.Status, query.Type, query.BeforeAt, query.BeforeID, query.Limit+1)
	if isInvalidUUID(err) {
		return nil, false, ErrInvalidQuery
	}
	if err != nil {
		return nil, false, fmt.Errorf("list jobs: %w", err)
	}
	defer rows.Close()

	items := make([]JobDiagnostic, 0, query.Limit+1)
	for rows.Next() {
		var item JobDiagnostic
		if err := rows.Scan(
			&item.ID, &item.Type, &item.Status, &item.Payload, &item.Priority,
			&item.Attempts, &item.MaxAttempts, &item.RunAt, &item.LockedAt,
			&item.LockedBy, &item.LastError, &item.CreatedAt, &item.UpdatedAt,
			&item.CompletedAt,
		); err != nil {
			return nil, false, fmt.Errorf("scan job: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("read jobs: %w", err)
	}

	hasMore := len(items) > query.Limit
	if hasMore {
		items = items[:query.Limit]
	}
	return items, hasMore, nil
}

func validJobStatus(status string) bool {
	switch status {
	case "", "queued", "running", "completed", "failed", "dead":
		return true
	default:
		return false
	}
}
