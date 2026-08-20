package nodes

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/mewisme/discloud/internal/acl"
)

type BrowserSort string
type BrowserOrder string

const (
	BrowserSortName    BrowserSort  = "name"
	BrowserSortUpdated BrowserSort  = "updated"
	BrowserSortSize    BrowserSort  = "size"
	BrowserOrderAsc    BrowserOrder = "asc"
	BrowserOrderDesc   BrowserOrder = "desc"
)

var ErrInvalidBrowserOptions = errors.New("invalid browser listing options")

type BrowserListOptions struct {
	Limit        int
	Sort         BrowserSort
	Order        BrowserOrder
	AfterValue   string
	AfterNameKey string
	AfterID      string
}

type BrowserNode struct {
	Node
	SizeBytes       *int64
	MIMEType        string
	Extension       string
	Category        string
	ThumbnailStatus string
	AccessLevel     acl.Level
	CanFavorite     bool
}

func (s *Service) Root(ctx context.Context, actor Actor) (Node, error) {
	node, err := scanNode(s.pool.QueryRow(ctx, `
		SELECT `+nodeColumns+`
		FROM nodes
		WHERE owner_user_id = $1::uuid
		  AND is_root
		  AND deleted_at IS NULL
	`, actor.UserID))
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return Node{}, ErrNotFound
	}
	if err != nil {
		return Node{}, fmt.Errorf("load root: %w", err)
	}
	return node, nil
}

func (s *Service) ListBrowserChildren(ctx context.Context, actor Actor, parentID string, options BrowserListOptions) ([]BrowserNode, bool, acl.Level, error) {
	options, err := normalizeBrowserListOptions(options)
	if err != nil {
		return nil, false, acl.None, err
	}

	parentLevel, err := s.acl.Resolve(ctx, parentID, actor.UserID, actor.Admin)
	if errors.Is(err, acl.ErrNotFound) {
		return nil, false, acl.None, ErrNotFound
	}
	if err != nil {
		return nil, false, acl.None, err
	}
	if err := accessError(parentLevel, acl.View); err != nil {
		return nil, false, acl.None, err
	}

	parent, err := loadNode(ctx, s.pool, parentID, false)
	if err != nil {
		return nil, false, acl.None, err
	}
	if parent.Kind != "folder" {
		return nil, false, acl.None, ErrNotFolder
	}

	sortExpr := "n.name_key"
	switch options.Sort {
	case BrowserSortUpdated:
		sortExpr = "n.updated_at"
	case BrowserSortSize:
		sortExpr = "COALESCE(f.size_bytes, 0)"
	}

	operator, direction := ">", "ASC"
	if options.Order == BrowserOrderDesc {
		operator, direction = "<", "DESC"
	}

	args := []any{parent.ID, options.Limit + 1, actor.UserID}
	query := `
		SELECT
			n.id::text,
			n.kind,
			n.owner_user_id::text,
			COALESCE(n.parent_id::text, ''),
			n.name,
			n.name_key,
			n.is_root,
			n.is_favorite,
			n.created_at,
			n.updated_at,
			f.size_bytes,
			COALESCE(f.mime_type, ''),
			COALESCE(f.extension, ''),
			COALESCE(f.category, ''),
			COALESCE(ft.status, ''),
			COALESCE(fp.level, '')
		FROM nodes n
		LEFT JOIN files f ON f.node_id = n.id
		LEFT JOIN file_thumbnails ft
		  ON ft.file_id = n.id
		 AND ft.variant = 'grid'
		LEFT JOIN folder_permissions fp
		  ON fp.folder_id = n.id
		 AND fp.user_id = $3::uuid
		WHERE n.parent_id = $1::uuid
		  AND n.deleted_at IS NULL
	`

	if options.AfterID != "" {
		switch options.Sort {
		case BrowserSortName:
			query += fmt.Sprintf("\n AND (n.name_key, n.id) %s ($4, $5::uuid)", operator)
			args = append(args, options.AfterValue, options.AfterID)
		case BrowserSortUpdated:
			query += fmt.Sprintf("\n AND (n.updated_at, n.name_key, n.id) %s ($4::timestamptz, $5, $6::uuid)", operator)
			args = append(args, options.AfterValue, options.AfterNameKey, options.AfterID)
		case BrowserSortSize:
			query += fmt.Sprintf("\n AND (COALESCE(f.size_bytes, 0), n.name_key, n.id) %s ($4::bigint, $5, $6::uuid)", operator)
			args = append(args, options.AfterValue, options.AfterNameKey, options.AfterID)
		}
	}

	if options.Sort == BrowserSortName {
		query += fmt.Sprintf("\n ORDER BY n.name_key %s, n.id %s", direction, direction)
	} else {
		query += fmt.Sprintf("\n ORDER BY %s %s, n.name_key %s, n.id %s", sortExpr, direction, direction, direction)
	}
	query += "\n LIMIT $2"

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		if isInvalidUUID(err) {
			return nil, false, acl.None, ErrInvalidCursor
		}
		return nil, false, acl.None, fmt.Errorf("list browser children: %w", err)
	}
	defer rows.Close()

	result := make([]BrowserNode, 0, options.Limit+1)
	for rows.Next() {
		var item BrowserNode
		var size pgtype.Int8
		var directLevel string

		if err := rows.Scan(
			&item.ID,
			&item.Kind,
			&item.OwnerID,
			&item.ParentID,
			&item.Name,
			&item.NameKey,
			&item.IsRoot,
			&item.IsFavorite,
			&item.CreatedAt,
			&item.UpdatedAt,
			&size,
			&item.MIMEType,
			&item.Extension,
			&item.Category,
			&item.ThumbnailStatus,
			&directLevel,
		); err != nil {
			return nil, false, acl.None, fmt.Errorf("scan browser child: %w", err)
		}

		if size.Valid {
			value := size.Int64
			item.SizeBytes = &value
		}

		item.AccessLevel, err = effectiveBrowserAccess(parentLevel, directLevel, actor.Admin || item.OwnerID == actor.UserID)
		if err != nil {
			return nil, false, acl.None, err
		}
		item.CanFavorite = actor.Admin || item.OwnerID == actor.UserID
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, acl.None, fmt.Errorf("read browser children: %w", err)
	}

	hasMore := len(result) > options.Limit
	if hasMore {
		result = result[:options.Limit]
	}
	return result, hasMore, parentLevel, nil
}

func effectiveBrowserAccess(inherited acl.Level, direct string, owner bool) (acl.Level, error) {
	if owner {
		return acl.Full, nil
	}
	if direct == "" {
		return inherited, nil
	}

	level, err := acl.ParseLevel(direct)
	if err != nil {
		return acl.None, fmt.Errorf("invalid stored permission level: %w", err)
	}
	if level > inherited {
		return level, nil
	}
	return inherited, nil
}

func normalizeBrowserListOptions(options BrowserListOptions) (BrowserListOptions, error) {
	if options.Limit == 0 {
		options.Limit = 50
	}
	if options.Limit < 1 || options.Limit > 100 {
		return BrowserListOptions{}, ErrInvalidBrowserOptions
	}
	if options.Sort == "" {
		options.Sort = BrowserSortName
	}
	if options.Order == "" {
		options.Order = BrowserOrderAsc
	}
	switch options.Sort {
	case BrowserSortName, BrowserSortUpdated, BrowserSortSize:
	default:
		return BrowserListOptions{}, ErrInvalidBrowserOptions
	}
	switch options.Order {
	case BrowserOrderAsc, BrowserOrderDesc:
	default:
		return BrowserListOptions{}, ErrInvalidBrowserOptions
	}

	if options.AfterID == "" {
		if options.AfterValue != "" || options.AfterNameKey != "" {
			return BrowserListOptions{}, ErrInvalidCursor
		}
		return options, nil
	}
	if options.AfterValue == "" {
		return BrowserListOptions{}, ErrInvalidCursor
	}

	switch options.Sort {
	case BrowserSortUpdated:
		if options.AfterNameKey == "" {
			return BrowserListOptions{}, ErrInvalidCursor
		}
		if _, err := time.Parse(time.RFC3339Nano, options.AfterValue); err != nil {
			return BrowserListOptions{}, ErrInvalidCursor
		}
	case BrowserSortSize:
		if options.AfterNameKey == "" {
			return BrowserListOptions{}, ErrInvalidCursor
		}
		value, err := strconv.ParseInt(options.AfterValue, 10, 64)
		if err != nil || value < 0 {
			return BrowserListOptions{}, ErrInvalidCursor
		}
	}
	return options, nil
}
