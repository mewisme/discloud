package nodes

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/postgres"
)

const MaxBatchFolders = 1000

var ErrInvalidBatch = errors.New("invalid folder batch")

type BatchFolderInput struct {
	ClientID       string
	ParentClientID string
	Name           string
}

type BatchFolderResult struct {
	ClientID string
	Node     Node
	Created  bool
}

type normalizedBatchFolder struct {
	ClientID       string
	ParentClientID string
	Name           string
	NameKey        string
}

func (s *Service) CreateFolderBatch(ctx context.Context, actor Actor, parentID string, inputs []BatchFolderInput) ([]BatchFolderResult, error) {
	specs, err := normalizeFolderBatch(inputs)
	if err != nil {
		return nil, err
	}

	preliminary, err := loadNode(ctx, s.pool, parentID, false)
	if err != nil {
		return nil, err
	}
	if preliminary.Kind != "folder" {
		return nil, ErrNotFolder
	}

	results := make(map[string]BatchFolderResult, len(specs))
	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockOwnerTree(ctx, tx, preliminary.OwnerID); err != nil {
			return err
		}

		root, err := loadNode(ctx, tx, parentID, true)
		if err != nil {
			return err
		}
		if root.Kind != "folder" {
			return ErrNotFolder
		}
		if err := s.requireTx(ctx, tx, actor, root.ID, acl.Edit); err != nil {
			return err
		}

		state := make(map[string]uint8, len(specs))
		created := 0

		var resolve func(string) (BatchFolderResult, error)
		resolve = func(clientID string) (BatchFolderResult, error) {
			if state[clientID] == 1 {
				return BatchFolderResult{}, ErrInvalidBatch
			}
			if state[clientID] == 2 {
				return results[clientID], nil
			}

			spec, ok := specs[clientID]
			if !ok {
				return BatchFolderResult{}, ErrInvalidBatch
			}

			state[clientID] = 1
			parent := root
			if spec.ParentClientID != "" {
				parentResult, err := resolve(spec.ParentClientID)
				if err != nil {
					return BatchFolderResult{}, err
				}
				parent = parentResult.Node
			}

			node, wasCreated, err := resolveBatchFolder(ctx, tx, actor.UserID, parent, spec)
			if err != nil {
				return BatchFolderResult{}, err
			}

			result := BatchFolderResult{ClientID: clientID, Node: node, Created: wasCreated}
			results[clientID] = result
			state[clientID] = 2
			if wasCreated {
				created++
			}
			return result, nil
		}

		for _, input := range inputs {
			if _, err := resolve(strings.TrimSpace(input.ClientID)); err != nil {
				return err
			}
		}

		if created == 0 {
			return nil
		}
		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actor.UserID,
			Action:       "folder.batch_create",
			ResourceType: "node",
			ResourceID:   root.ID,
			Metadata: map[string]any{
				"count":    len(inputs),
				"created":  created,
				"resolved": len(inputs) - created,
			},
		})
	})
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrNameConflict
		}
		return nil, err
	}

	ordered := make([]BatchFolderResult, len(inputs))
	for i, input := range inputs {
		ordered[i] = results[strings.TrimSpace(input.ClientID)]
	}
	return ordered, nil
}

func normalizeFolderBatch(inputs []BatchFolderInput) (map[string]normalizedBatchFolder, error) {
	if len(inputs) == 0 || len(inputs) > MaxBatchFolders {
		return nil, ErrInvalidBatch
	}

	specs := make(map[string]normalizedBatchFolder, len(inputs))
	paths := make(map[string]struct{}, len(inputs))

	for _, input := range inputs {
		clientID := strings.TrimSpace(input.ClientID)
		parentClientID := strings.TrimSpace(input.ParentClientID)
		if clientID == "" || len(clientID) > 128 || strings.ContainsRune(clientID, 0) || clientID == parentClientID {
			return nil, ErrInvalidBatch
		}
		if _, exists := specs[clientID]; exists {
			return nil, ErrInvalidBatch
		}

		name, nameKey, err := NormalizeName(input.Name)
		if err != nil {
			return nil, err
		}

		pathKey := parentClientID + "\x00" + nameKey
		if _, exists := paths[pathKey]; exists {
			return nil, ErrInvalidBatch
		}
		paths[pathKey] = struct{}{}

		specs[clientID] = normalizedBatchFolder{
			ClientID: clientID, ParentClientID: parentClientID,
			Name: name, NameKey: nameKey,
		}
	}

	for _, spec := range specs {
		if spec.ParentClientID != "" {
			if _, exists := specs[spec.ParentClientID]; !exists {
				return nil, ErrInvalidBatch
			}
		}
	}
	return specs, nil
}

func resolveBatchFolder(ctx context.Context, tx pgx.Tx, actorID string, parent Node, spec normalizedBatchFolder) (Node, bool, error) {
	node, err := scanNode(tx.QueryRow(ctx, `
		SELECT `+nodeColumns+`
		FROM nodes
		WHERE parent_id = $1::uuid
		  AND name_key = $2
		  AND deleted_at IS NULL
	`, parent.ID, spec.NameKey))
	if err == nil {
		if node.Kind != "folder" {
			return Node{}, false, ErrNameConflict
		}
		return node, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Node{}, false, fmt.Errorf("resolve batch folder: %w", err)
	}

	node, err = scanNode(tx.QueryRow(ctx, `
		INSERT INTO nodes (kind, owner_user_id, parent_id, name, name_key, created_by)
		VALUES ('folder', $1::uuid, $2::uuid, $3, $4, $5::uuid)
		RETURNING `+nodeColumns,
		parent.OwnerID, parent.ID, spec.Name, spec.NameKey, actorID,
	))
	if err != nil {
		return Node{}, false, fmt.Errorf("create batch folder: %w", err)
	}
	return node, true, nil
}
