package audit

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type Event struct {
	ActorUserID  string
	Action       string
	ResourceType string
	ResourceID   string
	RequestID    string
	IPAddress    string
	Metadata     map[string]any
}

func Append(ctx context.Context, tx pgx.Tx, event Event) error {
	if event.Metadata == nil {
		event.Metadata = map[string]any{}
	}

	_, err := tx.Exec(ctx, `
		INSERT INTO audit_events (
			actor_user_id, action, resource_type, resource_id,
			request_id, ip_address, metadata
		)
		VALUES (
			NULLIF($1, '')::uuid, $2, NULLIF($3, ''), NULLIF($4, '')::uuid,
			NULLIF($5, ''), NULLIF($6, '')::inet, $7
		)
	`, event.ActorUserID, event.Action, event.ResourceType, event.ResourceID, event.RequestID, event.IPAddress, event.Metadata)
	if err != nil {
		return fmt.Errorf("append audit event: %w", err)
	}
	return nil
}
