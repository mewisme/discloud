package adminops

import (
	"context"
	"fmt"
)

func (s *Service) ListUploads(ctx context.Context, query UploadQuery) ([]UploadDiagnostic, bool, error) {
	if !validPage(query.Limit, query.BeforeAt, query.BeforeID) || !validUploadStatus(query.Status) {
		return nil, false, ErrInvalidQuery
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			us.id::text,
			us.actor_user_id::text,
			actor.username::text,
			actor.name,
			us.owner_user_id::text,
			owner.username::text,
			owner.name,
			us.parent_folder_id::text,
			us.name,
			us.size_bytes,
			us.reserved_bytes,
			us.status,
			us.expected_parts,
			COALESCE(parts.uploaded_parts, 0),
			COALESCE(attempts.attempt_count, 0),
			COALESCE(attempts.failed_attempts, 0),
			COALESCE(last_failure.error_class, ''),
			COALESCE(last_failure.error_message, ''),
			us.created_at,
			us.updated_at,
			us.expires_at
		FROM upload_sessions us
		JOIN users actor ON actor.id = us.actor_user_id
		JOIN users owner ON owner.id = us.owner_user_id
		LEFT JOIN LATERAL (
			SELECT count(*) AS uploaded_parts
			FROM upload_parts up
			WHERE up.upload_id = us.id
		) parts ON true
		LEFT JOIN LATERAL (
			SELECT
				count(*) AS attempt_count,
				count(*) FILTER (WHERE status = 'failed') AS failed_attempts
			FROM chunk_upload_attempts cua
			WHERE cua.upload_session_id = us.id
		) attempts ON true
		LEFT JOIN LATERAL (
			SELECT error_class, error_message
			FROM chunk_upload_attempts cua
			WHERE cua.upload_session_id = us.id
			  AND cua.status = 'failed'
			ORDER BY cua.started_at DESC, cua.id DESC
			LIMIT 1
		) last_failure ON true
		WHERE ($1 = '' OR us.status = $1)
		  AND ($2 = '' OR us.owner_user_id = NULLIF($2, '')::uuid)
		  AND ($3 = '' OR us.actor_user_id = NULLIF($3, '')::uuid)
		  AND (
				$4::timestamptz IS NULL
				OR (us.updated_at, us.id) < ($4, NULLIF($5, '')::uuid)
		  )
		ORDER BY us.updated_at DESC, us.id DESC
		LIMIT $6
	`, query.Status, query.OwnerUserID, query.ActorUserID,
		query.BeforeAt, query.BeforeID, query.Limit+1)
	if isInvalidUUID(err) {
		return nil, false, ErrInvalidQuery
	}
	if err != nil {
		return nil, false, fmt.Errorf("list upload diagnostics: %w", err)
	}
	defer rows.Close()

	items := make([]UploadDiagnostic, 0, query.Limit+1)
	for rows.Next() {
		var item UploadDiagnostic
		if err := rows.Scan(
			&item.ID,
			&item.ActorUserID,
			&item.ActorUsername,
			&item.ActorName,
			&item.OwnerUserID,
			&item.OwnerUsername,
			&item.OwnerName,
			&item.ParentFolderID,
			&item.Name,
			&item.SizeBytes,
			&item.ReservedBytes,
			&item.Status,
			&item.ExpectedParts,
			&item.UploadedParts,
			&item.AttemptCount,
			&item.FailedAttempts,
			&item.LastErrorClass,
			&item.LastErrorMessage,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.ExpiresAt,
		); err != nil {
			return nil, false, fmt.Errorf("scan upload diagnostic: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("read upload diagnostics: %w", err)
	}

	hasMore := len(items) > query.Limit
	if hasMore {
		items = items[:query.Limit]
	}
	return items, hasMore, nil
}

func validUploadStatus(status string) bool {
	switch status {
	case "", "open", "completing", "completed", "cancelled", "expired", "failed":
		return true
	default:
		return false
	}
}
