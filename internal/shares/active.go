package shares

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/collections"
)

func (s *Service) Active(ctx context.Context, actor Actor, input CreateInput) (Share, error) {
	if _, err := ParseResourceType(string(input.ResourceType)); err != nil {
		return Share{}, err
	}
	if input.ResourceID == "" {
		return Share{}, ErrNotFound
	}
	if err := s.authorizeResource(ctx, actor, input.ResourceType, input.ResourceID); err != nil {
		return Share{}, err
	}

	id, err := activeShareID(ctx, s.pool, input)
	if err != nil {
		return Share{}, err
	}
	return loadShareByID(ctx, s.pool, id, true)
}

func (s *Service) authorizeResource(ctx context.Context, actor Actor, resourceType ResourceType, resourceID string) error {
	switch resourceType {
	case ResourceFile, ResourceFolder:
		var kind string
		err := s.pool.QueryRow(ctx, `
			SELECT kind
			FROM nodes
			WHERE id = $1::uuid
			  AND deleted_at IS NULL
		`, resourceID).Scan(&kind)
		if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("load shared node: %w", err)
		}
		if kind != string(resourceType) {
			return ErrNotFound
		}

		level, err := s.nodeACL.Resolve(ctx, resourceID, actor.UserID, actor.Admin)
		if errors.Is(err, acl.ErrNotFound) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if !level.Allows(acl.Full) {
			return ErrForbidden
		}
		return nil

	case ResourceCollection:
		if s.collections == nil {
			return ErrNotFound
		}

		err := s.collections.CanManage(ctx, collections.Actor{UserID: actor.UserID, Admin: actor.Admin}, resourceID)
		if errors.Is(err, collections.ErrNotFound) {
			return ErrNotFound
		}
		if errors.Is(err, collections.ErrForbidden) {
			return ErrForbidden
		}
		return err

	default:
		return ErrInvalidResourceType
	}
}
