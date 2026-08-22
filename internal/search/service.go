package search

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrForbidden     = errors.New("search filter is not allowed")
	ErrInvalidQuery  = errors.New("invalid search query")
	ErrInvalidCursor = errors.New("invalid search cursor")
)

type Sort string
type Order string
type State string

const (
	SortRelevance Sort = "relevance"
	SortName      Sort = "name"
	SortCreated   Sort = "created"
	SortUpdated   Sort = "updated"
	SortSize      Sort = "size"

	OrderAsc  Order = "asc"
	OrderDesc Order = "desc"

	StateActive State = "active"
	StateTrash  State = "trash"
	StateAll    State = "all"
)

type Actor struct {
	UserID string
	Admin  bool
}

type Input struct {
	Query        string
	Kind         string
	MIMEType     string
	Category     string
	OwnerID      string
	FolderID     string
	CollectionID string
	Favorite     *bool
	Shared       *bool
	MinSize      *int64
	MaxSize      *int64
	CreatedFrom  *time.Time
	CreatedTo    *time.Time
	UpdatedFrom  *time.Time
	UpdatedTo    *time.Time
	State        State
	Sort         Sort
	Order        Order
	Limit        int
	AfterKey     string
	AfterID      string
}

type Result struct {
	ID                 string
	Kind               string
	OwnerID            string
	ParentID           string
	Name               string
	NameKey            string
	IsFavorite         bool
	SizeBytes          *int64
	MIMEType           string
	Category           string
	StructuralAccess   bool
	AccessCollectionID string
	Shared             bool
	CreatedAt          time.Time
	UpdatedAt          time.Time
	Score              float64
	CursorKey          string
}

type Page struct {
	Items   []Result
	HasMore bool
}

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Search(ctx context.Context, actor Actor, input Input) (Page, error) {
	if err := normalizeInput(actor, &input); err != nil {
		return Page{}, err
	}

	afterKey, err := parseCursorKey(input)
	if err != nil {
		return Page{}, err
	}

	sortExpr, cursorCast := sortExpression(input.Sort)
	direction := strings.ToUpper(string(input.Order))
	operator := ">"
	if input.Order == OrderDesc {
		operator = "<"
	}

	cursorClause := ""
	if input.AfterID != "" {
		cursorClause = fmt.Sprintf(
			"AND (%s, node_uuid) %s (@after_key::%s, @after_id::uuid)",
			sortExpr,
			operator,
			cursorCast,
		)
	}

	query := `
		WITH RECURSIVE
		accessible_collections AS (
			SELECT c.id
			FROM collections c
			WHERE c.deleted_at IS NULL
				AND (
					(NOT @admin AND c.owner_user_id = @user_id::uuid)
					OR (
						@admin
						AND @collection_id::uuid IS NOT NULL
						AND c.id = @collection_id::uuid
					)
				)

			UNION

			SELECT c.id
			FROM collection_permissions cp
			JOIN collections c ON c.id = cp.collection_id
			WHERE NOT @admin
				AND cp.user_id = @user_id::uuid
				AND c.deleted_at IS NULL
		),
		grant_ancestry AS (
			SELECT
				fp.folder_id AS grant_id,
				n.id,
				n.parent_id,
				n.deleted_at
			FROM folder_permissions fp
			JOIN nodes n ON n.id = fp.folder_id
			WHERE NOT @admin
				AND fp.user_id = @user_id::uuid

			UNION ALL

			SELECT
				ancestry.grant_id,
				parent.id,
				parent.parent_id,
				parent.deleted_at
			FROM grant_ancestry ancestry
			JOIN nodes parent ON parent.id = ancestry.parent_id
		),
		active_grants AS (
			SELECT grant_id AS id
			FROM grant_ancestry
			GROUP BY grant_id
			HAVING BOOL_AND(deleted_at IS NULL)
				AND BOOL_OR(parent_id IS NULL)
		),
		structural_roots AS (
			SELECT n.id
			FROM nodes n
			WHERE n.is_root
				AND n.deleted_at IS NULL
				AND (@admin OR n.owner_user_id = @user_id::uuid)

			UNION

			SELECT id
			FROM active_grants
		),
		structural_access AS (
			SELECT id
			FROM structural_roots

			UNION

			SELECT child.id
			FROM nodes child
			JOIN structural_access parent ON child.parent_id = parent.id
			WHERE child.deleted_at IS NULL
		),
		collection_candidates AS (
			SELECT
				ci.file_id AS id,
				MIN(accessible.id::text) AS collection_id
			FROM accessible_collections accessible
			JOIN collection_items ci ON ci.collection_id = accessible.id
			LEFT JOIN structural_access structural ON structural.id = ci.file_id
			WHERE NOT @admin
				AND structural.id IS NULL
			GROUP BY ci.file_id
		),
		collection_ancestry AS (
			SELECT
				candidate.id AS file_id,
				n.id,
				n.parent_id,
				n.deleted_at
			FROM collection_candidates candidate
			JOIN nodes n ON n.id = candidate.id

			UNION ALL

			SELECT
				ancestry.file_id,
				parent.id,
				parent.parent_id,
				parent.deleted_at
			FROM collection_ancestry ancestry
			JOIN nodes parent ON parent.id = ancestry.parent_id
		),
		active_collection_files AS (
			SELECT file_id AS id
			FROM collection_ancestry
			GROUP BY file_id
			HAVING BOOL_AND(deleted_at IS NULL)
				AND BOOL_OR(parent_id IS NULL)
		),
		collection_access AS (
			SELECT
				candidate.id,
				candidate.collection_id
			FROM collection_candidates candidate
			JOIN active_collection_files active ON active.id = candidate.id
		),
		access_summary AS (
			SELECT
				id,
				true AS structural,
				NULL::text AS collection_id
			FROM structural_access

			UNION ALL

			SELECT
				id,
				false,
				collection_id
			FROM collection_access
		),
		filter_tree AS (
			SELECT n.id
			FROM nodes n
			JOIN structural_access access ON access.id = n.id
			WHERE @folder_id::uuid IS NOT NULL
				AND n.id = @folder_id::uuid
				AND n.kind = 'folder'

			UNION ALL

			SELECT child.id
			FROM nodes child
			JOIN filter_tree parent ON child.parent_id = parent.id
			WHERE child.deleted_at IS NULL
		),
		collection_scope AS (
			SELECT ci.file_id AS id
			FROM collection_items ci
			JOIN accessible_collections accessible
				ON accessible.id = ci.collection_id
			WHERE @collection_id::uuid IS NOT NULL
				AND ci.collection_id = @collection_id::uuid
		),
		shared_structural_roots AS (
			SELECT fp.folder_id AS id
			FROM folder_permissions fp
			JOIN structural_access access ON access.id = fp.folder_id

			UNION

			SELECT ps.node_id AS id
			FROM public_shares ps
			JOIN structural_access access ON access.id = ps.node_id
			WHERE ps.node_id IS NOT NULL
				AND ps.revoked_at IS NULL
		),
		shared_structural_nodes AS (
			SELECT id
			FROM shared_structural_roots

			UNION

			SELECT child.id
			FROM nodes child
			JOIN shared_structural_nodes parent ON child.parent_id = parent.id
			JOIN structural_access access ON access.id = child.id
			WHERE child.deleted_at IS NULL
		),
		shared_collection_ancestor_files AS (
			SELECT DISTINCT ancestry.file_id AS id
			FROM collection_ancestry ancestry
			JOIN active_collection_files active ON active.id = ancestry.file_id
			WHERE EXISTS (
					SELECT 1
					FROM folder_permissions fp
					WHERE fp.folder_id = ancestry.id
				)
				OR EXISTS (
					SELECT 1
					FROM public_shares ps
					WHERE ps.node_id = ancestry.id
						AND ps.revoked_at IS NULL
				)
		),
		shared_collection_files AS (
			SELECT DISTINCT ci.file_id AS id
			FROM collection_items ci
			JOIN access_summary access ON access.id = ci.file_id
			JOIN collections c ON c.id = ci.collection_id
			WHERE c.deleted_at IS NULL
				AND (
					EXISTS (
						SELECT 1
						FROM collection_permissions cp
						WHERE cp.collection_id = c.id
					)
					OR EXISTS (
						SELECT 1
						FROM public_shares ps
						WHERE ps.collection_id = c.id
							AND ps.revoked_at IS NULL
					)
				)
		),
		shared_nodes AS (
			SELECT id FROM shared_structural_nodes
			UNION
			SELECT id FROM shared_collection_ancestor_files
			UNION
			SELECT id FROM shared_collection_files
		),
		ranked AS (
			SELECT
				n.id AS node_uuid,
				n.id::text AS id,
				n.kind,
				n.owner_user_id::text AS owner_id,
				CASE
					WHEN @admin OR COALESCE(access.structural, false)
					THEN COALESCE(n.parent_id::text, '')
					ELSE ''
				END AS parent_id,
				n.name,
				n.name_key,
				n.is_favorite,
				f.size_bytes,
				COALESCE(f.mime_type, '') AS mime_type,
				COALESCE(f.category, '') AS category,
				(@admin OR COALESCE(access.structural, false)) AS structural_access,
				CASE
					WHEN @admin OR COALESCE(access.structural, false) THEN ''
					ELSE COALESCE(access.collection_id, '')
				END AS access_collection_id,
				(shared.id IS NOT NULL) AS shared,
				n.created_at,
				n.updated_at,
				CASE
					WHEN @query = '' THEN 0::double precision
					ELSE similarity(n.name, @query)::double precision
				END AS score,
				COALESCE(f.size_bytes, -1) AS size_sort
			FROM nodes n
			LEFT JOIN files f ON f.node_id = n.id
			LEFT JOIN access_summary access ON access.id = n.id
			LEFT JOIN filter_tree folder_scope ON folder_scope.id = n.id
			LEFT JOIN collection_scope collection_filter ON collection_filter.id = n.id
			LEFT JOIN shared_nodes shared ON shared.id = n.id
			WHERE NOT n.is_root
				AND (
					(@state = 'active' AND access.id IS NOT NULL)
					OR (@state = 'trash' AND @admin AND n.deleted_at IS NOT NULL)
					OR (@state = 'all' AND @admin)
				)
				AND (
					@query = ''
					OR n.name % @query
					OR n.name ILIKE '%' || @query || '%'
				)
				AND (@kind = '' OR n.kind = @kind)
				AND (@mime_type = '' OR f.mime_type = @mime_type)
				AND (@category = '' OR f.category = @category)
				AND (@owner_id::uuid IS NULL OR n.owner_user_id = @owner_id::uuid)
				AND (@folder_id::uuid IS NULL OR folder_scope.id IS NOT NULL)
				AND (@collection_id::uuid IS NULL OR collection_filter.id IS NOT NULL)
				AND (@favorite::boolean IS NULL OR n.is_favorite = @favorite)
				AND (@shared::boolean IS NULL OR (shared.id IS NOT NULL) = @shared)
				AND (@min_size::bigint IS NULL OR f.size_bytes >= @min_size)
				AND (@max_size::bigint IS NULL OR f.size_bytes <= @max_size)
				AND (@created_from::timestamptz IS NULL OR n.created_at >= @created_from)
				AND (@created_to::timestamptz IS NULL OR n.created_at <= @created_to)
				AND (@updated_from::timestamptz IS NULL OR n.updated_at >= @updated_from)
				AND (@updated_to::timestamptz IS NULL OR n.updated_at <= @updated_to)
		)
		SELECT
			id,
			kind,
			owner_id,
			parent_id,
			name,
			name_key,
			is_favorite,
			size_bytes,
			mime_type,
			category,
			structural_access,
			access_collection_id,
			shared,
			created_at,
			updated_at,
			score,
			size_sort
		FROM ranked
		WHERE true
		` + cursorClause + `
		ORDER BY ` + sortExpr + ` ` + direction + `, node_uuid ` + direction + `
		LIMIT @limit
	`

	args := pgx.NamedArgs{
		"user_id":       actor.UserID,
		"admin":         actor.Admin,
		"query":         input.Query,
		"kind":          input.Kind,
		"mime_type":     input.MIMEType,
		"category":      input.Category,
		"owner_id":      nullableString(input.OwnerID),
		"folder_id":     nullableString(input.FolderID),
		"collection_id": nullableString(input.CollectionID),
		"favorite":      input.Favorite,
		"shared":        input.Shared,
		"min_size":      input.MinSize,
		"max_size":      input.MaxSize,
		"created_from":  input.CreatedFrom,
		"created_to":    input.CreatedTo,
		"updated_from":  input.UpdatedFrom,
		"updated_to":    input.UpdatedTo,
		"state":         input.State,
		"limit":         input.Limit + 1,
		"after_key":     afterKey,
		"after_id":      nullableString(input.AfterID),
	}

	rows, err := s.pool.Query(ctx, query, args)
	if err != nil {
		if isInvalidUUID(err) {
			return Page{}, ErrInvalidCursor
		}
		return Page{}, fmt.Errorf("search nodes: %w", err)
	}
	defer rows.Close()

	items := make([]Result, 0, input.Limit+1)
	for rows.Next() {
		var item Result
		var sizeSort int64
		if err := rows.Scan(
			&item.ID,
			&item.Kind,
			&item.OwnerID,
			&item.ParentID,
			&item.Name,
			&item.NameKey,
			&item.IsFavorite,
			&item.SizeBytes,
			&item.MIMEType,
			&item.Category,
			&item.StructuralAccess,
			&item.AccessCollectionID,
			&item.Shared,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.Score,
			&sizeSort,
		); err != nil {
			return Page{}, fmt.Errorf("scan search result: %w", err)
		}

		item.CursorKey = resultCursorKey(item, sizeSort, input.Sort)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return Page{}, fmt.Errorf("read search results: %w", err)
	}

	hasMore := len(items) > input.Limit
	if hasMore {
		items = items[:input.Limit]
	}
	return Page{Items: items, HasMore: hasMore}, nil
}

func normalizeInput(actor Actor, input *Input) error {
	input.Query = strings.TrimSpace(input.Query)
	input.Kind = strings.TrimSpace(input.Kind)
	input.MIMEType = strings.TrimSpace(input.MIMEType)
	input.Category = strings.TrimSpace(input.Category)
	input.OwnerID = strings.TrimSpace(input.OwnerID)
	input.FolderID = strings.TrimSpace(input.FolderID)
	input.CollectionID = strings.TrimSpace(input.CollectionID)

	if len(input.Query) > 256 || input.Limit < 1 || input.Limit > 100 {
		return ErrInvalidQuery
	}
	if input.Kind != "" && input.Kind != "file" && input.Kind != "folder" {
		return ErrInvalidQuery
	}
	if input.MinSize != nil && *input.MinSize < 0 ||
		input.MaxSize != nil && *input.MaxSize < 0 ||
		input.MinSize != nil && input.MaxSize != nil && *input.MinSize > *input.MaxSize {
		return ErrInvalidQuery
	}
	if input.CreatedFrom != nil && input.CreatedTo != nil && input.CreatedFrom.After(*input.CreatedTo) ||
		input.UpdatedFrom != nil && input.UpdatedTo != nil && input.UpdatedFrom.After(*input.UpdatedTo) {
		return ErrInvalidQuery
	}

	if input.State == "" {
		input.State = StateActive
	}
	if input.State != StateActive && input.State != StateTrash && input.State != StateAll {
		return ErrInvalidQuery
	}
	if !actor.Admin && input.State != StateActive {
		return ErrForbidden
	}
	if input.OwnerID != "" && !actor.Admin && input.OwnerID != actor.UserID {
		return ErrForbidden
	}

	if input.Sort == "" {
		if input.Query == "" {
			input.Sort = SortUpdated
		} else {
			input.Sort = SortRelevance
		}
	}
	switch input.Sort {
	case SortRelevance, SortName, SortCreated, SortUpdated, SortSize:
	default:
		return ErrInvalidQuery
	}

	if input.Order == "" {
		if input.Sort == SortName {
			input.Order = OrderAsc
		} else {
			input.Order = OrderDesc
		}
	}
	if input.Order != OrderAsc && input.Order != OrderDesc {
		return ErrInvalidQuery
	}

	if (input.AfterID == "") != (input.AfterKey == "") {
		return ErrInvalidCursor
	}
	return nil
}

func parseCursorKey(input Input) (any, error) {
	if input.AfterID == "" {
		return nil, nil
	}

	switch input.Sort {
	case SortRelevance:
		value, err := strconv.ParseFloat(input.AfterKey, 64)
		if err != nil {
			return nil, ErrInvalidCursor
		}
		return value, nil

	case SortName:
		return input.AfterKey, nil

	case SortCreated, SortUpdated:
		value, err := time.Parse(time.RFC3339Nano, input.AfterKey)
		if err != nil {
			return nil, ErrInvalidCursor
		}
		return value, nil

	case SortSize:
		value, err := strconv.ParseInt(input.AfterKey, 10, 64)
		if err != nil {
			return nil, ErrInvalidCursor
		}
		return value, nil
	}

	return nil, ErrInvalidCursor
}

func sortExpression(sort Sort) (string, string) {
	switch sort {
	case SortName:
		return "name_key", "text"
	case SortCreated:
		return "created_at", "timestamptz"
	case SortUpdated:
		return "updated_at", "timestamptz"
	case SortSize:
		return "size_sort", "bigint"
	default:
		return "score", "double precision"
	}
}

func resultCursorKey(item Result, sizeSort int64, sort Sort) string {
	switch sort {
	case SortName:
		return item.NameKey
	case SortCreated:
		return item.CreatedAt.Format(time.RFC3339Nano)
	case SortUpdated:
		return item.UpdatedAt.Format(time.RFC3339Nano)
	case SortSize:
		return strconv.FormatInt(sizeSort, 10)
	default:
		return strconv.FormatFloat(item.Score, 'g', -1, 64)
	}
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func isInvalidUUID(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "22P02"
}
