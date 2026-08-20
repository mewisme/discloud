package avatars

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/media"
	"github.com/mewisme/discloud/internal/objects"
)

var ErrNotFound = errors.New("avatar not found")

type Info struct {
	HasAvatar bool
	Revision  int64
}

type Service struct {
	pool    *pgxpool.Pool
	objects *objects.Service
}

func New(pool *pgxpool.Pool, objectService *objects.Service) *Service {
	return &Service{pool: pool, objects: objectService}
}

func (s *Service) Put(ctx context.Context, userID string, src io.Reader) (Info, error) {
	processed, err := media.ProcessAvatar(src)
	if err != nil {
		return Info{}, err
	}
	if s == nil || s.pool == nil || s.objects == nil {
		return Info{}, objects.ErrUnavailable
	}

	object, err := s.objects.Put(ctx, "avatar", processed.Filename, processed.MIMEType, bytes.NewReader(processed.Data))
	if err != nil {
		return Info{}, err
	}

	var revision int64
	err = s.pool.QueryRow(ctx, `
		UPDATE users
		SET avatar_object_id = $2::uuid,
		    avatar_revision = avatar_revision + 1,
		    updated_at = now()
		WHERE id = $1::uuid
		RETURNING avatar_revision
	`, userID, object.ID).Scan(&revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return Info{}, ErrNotFound
	}
	if err != nil {
		return Info{}, fmt.Errorf("set user avatar: %w", err)
	}
	return Info{HasAvatar: true, Revision: revision}, nil
}

func (s *Service) Delete(ctx context.Context, userID string) error {
	if s == nil || s.pool == nil {
		return objects.ErrUnavailable
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE users
		SET avatar_object_id = NULL,
		    avatar_revision = avatar_revision + 1,
		    updated_at = now()
		WHERE id = $1::uuid
		  AND avatar_object_id IS NOT NULL
	`, userID)
	if err != nil {
		return fmt.Errorf("delete user avatar: %w", err)
	}
	return nil
}

func (s *Service) ResolveURL(ctx context.Context, userID string) (string, error) {
	if s == nil || s.pool == nil || s.objects == nil {
		return "", objects.ErrUnavailable
	}

	var objectID string
	err := s.pool.QueryRow(ctx, `
		SELECT avatar_object_id::text
		FROM users
		WHERE id = $1::uuid
		  AND avatar_object_id IS NOT NULL
	`, userID).Scan(&objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("load user avatar: %w", err)
	}
	return s.objects.ResolveURL(ctx, objectID)
}
