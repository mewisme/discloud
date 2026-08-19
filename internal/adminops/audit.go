package adminops

import (
	"context"
	"fmt"
)

func (s *Service) ListAudit(ctx context.Context, query AuditQuery) ([]AuditEvent, bool, error) {
	if !validPage(query.Limit, query.BeforeAt, query.BeforeID) ||
		query.From != nil && query.To != nil && query.From.After(*query.To) {
		return nil, false, ErrInvalidQuery
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			id::text,
			COALESCE(actor_user_id::text, ''),
			action,
			COALESCE(resource_type, ''),
			COALESCE(resource_id::text, ''),
			COALESCE(request_id, ''),
			COALESCE(ip_address::text, ''),
			metadata,
			created_at
		FROM audit_events
		WHERE ($1 = '' OR actor_user_id = NULLIF($1, '')::uuid)
		  AND ($2 = '' OR action = $2)
		  AND ($3 = '' OR resource_type = $3)
		  AND ($4 = '' OR resource_id = NULLIF($4, '')::uuid)
		  AND ($5::timestamptz IS NULL OR created_at >= $5)
		  AND ($6::timestamptz IS NULL OR created_at <= $6)
		  AND (
				$7::timestamptz IS NULL
				OR (created_at, id) < ($7, NULLIF($8, '')::uuid)
		  )
		ORDER BY created_at DESC, id DESC
		LIMIT $9
	`, query.ActorUserID, query.Action, query.ResourceType, query.ResourceID,
		query.From, query.To, query.BeforeAt, query.BeforeID, query.Limit+1)
	if isInvalidUUID(err) {
		return nil, false, ErrInvalidQuery
	}
	if err != nil {
		return nil, false, fmt.Errorf("list audit events: %w", err)
	}
	defer rows.Close()

	items := make([]AuditEvent, 0, query.Limit+1)
	for rows.Next() {
		var item AuditEvent
		if err := rows.Scan(
			&item.ID, &item.ActorUserID, &item.Action, &item.ResourceType,
			&item.ResourceID, &item.RequestID, &item.IPAddress, &item.Metadata,
			&item.CreatedAt,
		); err != nil {
			return nil, false, fmt.Errorf("scan audit event: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("read audit events: %w", err)
	}

	hasMore := len(items) > query.Limit
	if hasMore {
		items = items[:query.Limit]
	}
	return items, hasMore, nil
}
