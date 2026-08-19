package nodes

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/postgres"
)

func (s *Service) SetFavorite(ctx context.Context, actor Actor, nodeID string, favorite bool) (Node, error) {
	preliminary, err := loadNode(ctx, s.pool, nodeID, false)
	if err != nil {
		return Node{}, err
	}
	if !actor.Admin && preliminary.OwnerID != actor.UserID {
		return Node{}, ErrForbidden
	}

	var node Node
	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockOwnerTree(ctx, tx, preliminary.OwnerID); err != nil {
			return err
		}

		current, err := loadNode(ctx, tx, nodeID, true)
		if err != nil {
			return err
		}
		if !actor.Admin && current.OwnerID != actor.UserID {
			return ErrForbidden
		}
		if current.IsFavorite == favorite {
			node = current
			return nil
		}

		err = tx.QueryRow(ctx, `
			UPDATE nodes
			SET is_favorite = $2,
			    updated_at = now()
			WHERE id = $1::uuid
			RETURNING `+nodeColumns,
			current.ID, favorite,
		).Scan(
			&node.ID,
			&node.Kind,
			&node.OwnerID,
			&node.ParentID,
			&node.Name,
			&node.NameKey,
			&node.IsRoot,
			&node.IsFavorite,
			&node.CreatedAt,
			&node.UpdatedAt,
		)
		if err != nil {
			return fmt.Errorf("set node favorite: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actor.UserID,
			Action:       "node.favorite_set",
			ResourceType: "node",
			ResourceID:   node.ID,
			Metadata: map[string]any{
				"favorite": favorite,
			},
		})
	})
	if err != nil {
		return Node{}, err
	}
	return node, nil
}
