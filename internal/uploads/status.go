package uploads

import (
	"context"
	"fmt"
)

func (s *Service) ListParts(ctx context.Context, actor Actor, sessionID string) ([]Part, error) {
	session, err := s.Get(ctx, actor, sessionID)
	if err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT upload_id::text, part_index, chunk_id::text, part_size_bytes, sha256, created_at
		FROM upload_parts
		WHERE upload_id = $1::uuid
		ORDER BY part_index
	`, session.ID)
	if err != nil {
		return nil, fmt.Errorf("list upload parts: %w", err)
	}
	defer rows.Close()

	parts := make([]Part, 0, session.ExpectedParts)
	for rows.Next() {
		part, err := scanPart(rows)
		if err != nil {
			return nil, fmt.Errorf("scan upload part: %w", err)
		}
		parts = append(parts, part)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read upload parts: %w", err)
	}
	return parts, nil
}
