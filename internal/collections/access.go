package collections

import (
	"context"

	"github.com/jackc/pgx/v5"
)

func (s *Service) CanManage(ctx context.Context, actor Actor, collectionID string) error {
	state, err := loadState(ctx, s.pool, collectionID, false, false)
	if err != nil {
		return err
	}
	return requireLevel(ctx, s.pool, state, actor, Full)
}

func (s *Service) CanManageTx(ctx context.Context, tx pgx.Tx, actor Actor, collectionID string) error {
	state, err := loadState(ctx, tx, collectionID, false, true)
	if err != nil {
		return err
	}
	return requireLevel(ctx, tx, state, actor, Full)
}
