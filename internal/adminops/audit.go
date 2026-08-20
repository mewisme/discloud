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
			ae.id::text,
			COALESCE(ae.actor_user_id::text, ''),
			COALESCE(actor.username::text, ''),
			COALESCE(actor.name, ''),
			ae.action,
			COALESCE(ae.resource_type, ''),
			COALESCE(ae.resource_id::text, ''),
			COALESCE(ae.request_id, ''),
			COALESCE(ae.ip_address::text, ''),
			ae.metadata,
			ae.created_at
		FROM audit_events ae
		LEFT JOIN users actor ON actor.id = ae.actor_user_id
		WHERE ($1 = '' OR ae.actor_user_id = NULLIF($1, '')::uuid)
		  AND ($2 = '' OR ae.action = $2)
		  AND ($3 = '' OR ae.resource_type = $3)
		  AND ($4 = '' OR ae.resource_id = NULLIF($4, '')::uuid)
		  AND ($5::timestamptz IS NULL OR ae.created_at >= $5)
		  AND ($6::timestamptz IS NULL OR ae.created_at <= $6)
		  AND (
				$7::timestamptz IS NULL
				OR (ae.created_at, ae.id) < ($7, NULLIF($8, '')::uuid)
		  )
		ORDER BY ae.created_at DESC, ae.id DESC
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
			&item.ID,
			&item.ActorUserID,
			&item.ActorUsername,
			&item.ActorName,
			&item.Action,
			&item.ResourceType,
			&item.ResourceID,
			&item.RequestID,
			&item.IPAddress,
			&item.Metadata,
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
