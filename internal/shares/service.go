package shares

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/collections"
	"github.com/mewisme/discloud/internal/postgres"
)

const publicIDBytes = 32

var (
	ErrNotFound            = errors.New("public share not found")
	ErrForbidden           = errors.New("public share permission denied")
	ErrInvalidResourceType = errors.New("invalid public share resource type")
	ErrPublicIDGeneration  = errors.New("could not generate public share ID")
)

type ResourceType string

const (
	ResourceFile       ResourceType = "file"
	ResourceFolder     ResourceType = "folder"
	ResourceCollection ResourceType = "collection"
)

type Actor struct {
	UserID string
	Admin  bool
}

type Share struct {
	ID           string
	PublicID     string
	ResourceType ResourceType
	ResourceID   string
	CreatedBy    string
	CreatedAt    time.Time
}

type CreateInput struct {
	ResourceType ResourceType
	ResourceID   string
}

type CreateResult struct {
	Share   Share
	Created bool
}

type Service struct {
	pool        *pgxpool.Pool
	nodeACL     *acl.Service
	collections *collections.Service
}

type scanner interface {
	Scan(...any) error
}

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func New(pool *pgxpool.Pool, collectionService *collections.Service) *Service {
	return &Service{
		pool:        pool,
		nodeACL:     acl.New(pool),
		collections: collectionService,
	}
}

func ParseResourceType(value string) (ResourceType, error) {
	switch ResourceType(value) {
	case ResourceFile, ResourceFolder, ResourceCollection:
		return ResourceType(value), nil
	default:
		return "", ErrInvalidResourceType
	}
}

func (s *Service) Create(ctx context.Context, actor Actor, input CreateInput) (CreateResult, error) {
	if _, err := ParseResourceType(string(input.ResourceType)); err != nil {
		return CreateResult{}, err
	}
	if input.ResourceID == "" {
		return CreateResult{}, ErrNotFound
	}

	var result CreateResult
	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := s.authorizeResourceTx(ctx, tx, actor, input.ResourceType, input.ResourceID); err != nil {
			return err
		}

		for range 4 {
			publicID, err := generatePublicID()
			if err != nil {
				return err
			}

			shareID, err := insertShare(ctx, tx, actor.UserID, input, publicID)
			if err == nil {
				result.Share, err = loadShareByID(ctx, tx, shareID, true)
				if err != nil {
					return err
				}
				result.Created = true

				return audit.Append(ctx, tx, audit.Event{
					ActorUserID:  actor.UserID,
					Action:       "share.create",
					ResourceType: "share",
					ResourceID:   result.Share.ID,
					Metadata: map[string]any{
						"resourceType": result.Share.ResourceType,
						"resourceId":   result.Share.ResourceID,
					},
				})
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}

			existingID, err := activeShareID(ctx, tx, input)
			if err == nil {
				result.Share, err = loadShareByID(ctx, tx, existingID, true)
				return err
			}
			if !errors.Is(err, ErrNotFound) {
				return err
			}

			// ponytail: only possible path here is a public_id collision.
		}

		return ErrPublicIDGeneration
	})
	if err != nil {
		return CreateResult{}, err
	}
	return result, nil
}

func (s *Service) Revoke(ctx context.Context, actor Actor, shareID string) error {
	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		share, err := loadShareByID(ctx, tx, shareID, true)
		if err != nil {
			return err
		}

		if err := s.authorizeResourceTx(ctx, tx, actor, share.ResourceType, share.ResourceID); err != nil {
			return err
		}

		tag, err := tx.Exec(ctx, `
			UPDATE public_shares
			SET revoked_at = now(), revoked_by = $2::uuid
			WHERE id = $1::uuid
			  AND revoked_at IS NULL
		`, share.ID, actor.UserID)
		if err != nil {
			return fmt.Errorf("revoke public share: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrNotFound
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actor.UserID,
			Action:       "share.revoke",
			ResourceType: "share",
			ResourceID:   share.ID,
			Metadata: map[string]any{
				"resourceType": share.ResourceType,
				"resourceId":   share.ResourceID,
			},
		})
	})
}

func (s *Service) Resolve(ctx context.Context, publicID string) (Share, error) {
	if publicID == "" {
		return Share{}, ErrNotFound
	}

	var share Share
	var resourceType string

	err := s.pool.QueryRow(ctx, `
		SELECT
			ps.id::text,
			ps.public_id,
			CASE
				WHEN ps.resource_type = 'collection' THEN 'collection'
				ELSE n.kind
			END,
			COALESCE(ps.node_id::text, ps.collection_id::text),
			ps.created_by::text,
			ps.created_at
		FROM public_shares ps
		LEFT JOIN nodes n ON n.id = ps.node_id
		LEFT JOIN collections c ON c.id = ps.collection_id
		WHERE ps.public_id = $1
		  AND ps.revoked_at IS NULL
		  AND (
				(
					ps.resource_type = 'collection'
					AND c.deleted_at IS NULL
				)
				OR
				(
					ps.resource_type = 'node'
					AND n.deleted_at IS NULL
					AND NOT EXISTS (
						WITH RECURSIVE chain AS (
							SELECT id, parent_id, deleted_at
							FROM nodes
							WHERE id = ps.node_id

							UNION ALL

							SELECT parent.id, parent.parent_id, parent.deleted_at
							FROM nodes parent
							JOIN chain child ON child.parent_id = parent.id
						)
						SELECT 1
						FROM chain
						WHERE deleted_at IS NOT NULL
					)
				)
		  )
	`, publicID).Scan(
		&share.ID,
		&share.PublicID,
		&resourceType,
		&share.ResourceID,
		&share.CreatedBy,
		&share.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Share{}, ErrNotFound
	}
	if err != nil {
		return Share{}, fmt.Errorf("resolve public share: %w", err)
	}

	share.ResourceType, err = ParseResourceType(resourceType)
	if err != nil {
		return Share{}, fmt.Errorf("resolve public share type: %w", err)
	}
	return share, nil
}

func (s *Service) authorizeResourceTx(ctx context.Context, tx pgx.Tx, actor Actor, resourceType ResourceType, resourceID string) error {
	switch resourceType {
	case ResourceFile, ResourceFolder:
		var kind string
		err := tx.QueryRow(ctx, `
			SELECT kind
			FROM nodes
			WHERE id = $1::uuid
			  AND deleted_at IS NULL
			FOR UPDATE
		`, resourceID).Scan(&kind)
		if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock shared node: %w", err)
		}
		if kind != string(resourceType) {
			return ErrNotFound
		}

		level, err := s.nodeACL.ResolveTx(ctx, tx, resourceID, actor.UserID, actor.Admin)
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

		err := s.collections.CanManageTx(ctx, tx, collections.Actor{
			UserID: actor.UserID,
			Admin:  actor.Admin,
		}, resourceID)
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

func insertShare(ctx context.Context, tx pgx.Tx, actorID string, input CreateInput, publicID string) (string, error) {
	var shareID string

	switch input.ResourceType {
	case ResourceFile, ResourceFolder:
		err := tx.QueryRow(ctx, `
			INSERT INTO public_shares (
				public_id, resource_type, node_id, created_by
			)
			VALUES ($1, 'node', $2::uuid, $3::uuid)
			ON CONFLICT DO NOTHING
			RETURNING id::text
		`, publicID, input.ResourceID, actorID).Scan(&shareID)
		return shareID, err

	case ResourceCollection:
		err := tx.QueryRow(ctx, `
			INSERT INTO public_shares (
				public_id, resource_type, collection_id, created_by
			)
			VALUES ($1, 'collection', $2::uuid, $3::uuid)
			ON CONFLICT DO NOTHING
			RETURNING id::text
		`, publicID, input.ResourceID, actorID).Scan(&shareID)
		return shareID, err

	default:
		return "", ErrInvalidResourceType
	}
}

func activeShareID(ctx context.Context, db queryRower, input CreateInput) (string, error) {
	var id string
	var err error

	switch input.ResourceType {
	case ResourceFile, ResourceFolder:
		err = db.QueryRow(ctx, `
			SELECT id::text
			FROM public_shares
			WHERE node_id = $1::uuid
			  AND revoked_at IS NULL
		`, input.ResourceID).Scan(&id)

	case ResourceCollection:
		err = db.QueryRow(ctx, `
			SELECT id::text
			FROM public_shares
			WHERE collection_id = $1::uuid
			  AND revoked_at IS NULL
		`, input.ResourceID).Scan(&id)

	default:
		return "", ErrInvalidResourceType
	}

	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("find active public share: %w", err)
	}
	return id, nil
}

func loadShareByID(ctx context.Context, db queryRower, shareID string, activeOnly bool) (Share, error) {
	query := `
		SELECT
			ps.id::text,
			ps.public_id,
			CASE
				WHEN ps.resource_type = 'collection' THEN 'collection'
				ELSE n.kind
			END,
			COALESCE(ps.node_id::text, ps.collection_id::text),
			ps.created_by::text,
			ps.created_at
		FROM public_shares ps
		LEFT JOIN nodes n ON n.id = ps.node_id
		WHERE ps.id = $1::uuid
	`
	if activeOnly {
		query += ` AND ps.revoked_at IS NULL`
	}

	var share Share
	var resourceType string
	err := db.QueryRow(ctx, query, shareID).Scan(
		&share.ID,
		&share.PublicID,
		&resourceType,
		&share.ResourceID,
		&share.CreatedBy,
		&share.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return Share{}, ErrNotFound
	}
	if err != nil {
		return Share{}, fmt.Errorf("load public share: %w", err)
	}

	share.ResourceType, err = ParseResourceType(resourceType)
	if err != nil {
		return Share{}, fmt.Errorf("load public share type: %w", err)
	}
	return share, nil
}

func generatePublicID() (string, error) {
	var raw [publicIDBytes]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("%w: %v", ErrPublicIDGeneration, err)
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func isInvalidUUID(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "22P02"
}
