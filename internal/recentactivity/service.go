package recentactivity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/postgres"
)

var (
	ErrForbidden    = errors.New("recent activity access denied")
	ErrInvalidQuery = errors.New("invalid recent activity query")
)

const defaultLimit = 30

var visibleActions = []string{
	"file.create", "file.version.create", "node.rename", "node.move", "node.trash", "node.restore",
	"share.create", "share.update", "share.revoke", "sync.run",
}

var adminActions = []string{"user.create", "user.update", "user.quota_update", "user.password_reset", "user.active", "user.disabled"}

type Actor struct {
	UserID string
	Admin  bool
}

type Query struct {
	OwnerID  string
	Limit    int
	BeforeAt *time.Time
	BeforeID string
}

type Person struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
}

type Target struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Item struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Action    string    `json:"action"`
	Actor     Person    `json:"actor"`
	Target    Target    `json:"target"`
	Detail    string    `json:"detail,omitempty"`
	AdminOnly bool      `json:"adminOnly,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type Cursor struct {
	BeforeAt time.Time `json:"beforeAt"`
	BeforeID string    `json:"beforeId"`
}

type Page struct {
	Items      []Item  `json:"items"`
	NextCursor *Cursor `json:"nextCursor,omitempty"`
}

type SyncResult struct {
	Uploaded             int64 `json:"uploaded"`
	Downloaded           int64 `json:"downloaded"`
	RemoteDeleted        int64 `json:"remoteDeleted"`
	LocalDeleted         int64 `json:"localDeleted"`
	Conflicts            int64 `json:"conflicts"`
	CreatedRemoteFolders int64 `json:"createdRemoteFolders"`
	CreatedLocalFolders  int64 `json:"createdLocalFolders"`
	Skipped              int64 `json:"skipped"`
}

type SyncInput struct {
	PairID           string     `json:"pairId"`
	RemoteFolderID   string     `json:"remoteFolderId"`
	RemoteFolderName string     `json:"remoteFolderName"`
	Direction        string     `json:"direction"`
	Result           SyncResult `json:"result"`
}

type rawItem struct {
	ID, ActorID, ActorUsername, ActorName, Action  string
	NodeID, NodeName, NodeKind                     string
	ShareNodeID, ShareNodeName, ShareNodeKind      string
	ShareCollectionID, ShareCollectionName         string
	ResourceUserID, ResourceUsername, ResourceName string
	Metadata                                       json.RawMessage
	CreatedAt                                      time.Time
}

type Service struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) List(ctx context.Context, actor Actor, query Query) (Page, error) {
	ownerID, err := normalizeOwnerID(actor, query.OwnerID)
	if err != nil {
		return Page{}, err
	}
	limit := query.Limit
	if limit == 0 {
		limit = defaultLimit
	}
	if limit < 1 || limit > 100 || (query.BeforeAt == nil) != (query.BeforeID == "") {
		return Page{}, ErrInvalidQuery
	}

	actions := append([]string{}, visibleActions...)
	if actor.Admin {
		actions = append(actions, adminActions...)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT
			ae.id::text,
			COALESCE(actor.id::text, ''), COALESCE(actor.username::text, ''), COALESCE(actor.name, ''), ae.action,
			COALESCE(n.id::text, ''), COALESCE(n.name, ''), COALESCE(n.kind, ''),
			COALESCE(sn.id::text, ''), COALESCE(sn.name, ''), COALESCE(sn.kind, ''),
			COALESCE(sc.id::text, ''), COALESCE(sc.name, ''),
			COALESCE(ru.id::text, ''), COALESCE(ru.username::text, ''), COALESCE(ru.name, ''),
			ae.metadata, ae.created_at
		FROM audit_events ae
		LEFT JOIN users actor ON actor.id = ae.actor_user_id
		LEFT JOIN nodes n ON ae.resource_type = 'node' AND n.id = ae.resource_id
		LEFT JOIN public_shares ps ON ae.resource_type = 'share' AND ps.id = ae.resource_id
		LEFT JOIN nodes sn ON sn.id = ps.node_id
		LEFT JOIN collections sc ON sc.id = ps.collection_id
		LEFT JOIN users ru ON ae.resource_type = 'user' AND ru.id = ae.resource_id
		WHERE ae.action = ANY($2::text[])
		  AND COALESCE(n.owner_user_id, sn.owner_user_id, sc.owner_user_id, ru.id) = $1::uuid
		  AND ($3::timestamptz IS NULL OR (ae.created_at, ae.id) < ($3, NULLIF($4, '')::uuid))
		ORDER BY ae.created_at DESC, ae.id DESC
		LIMIT $5
	`, ownerID, actions, query.BeforeAt, query.BeforeID, limit+1)
	if isInvalidUUID(err) {
		return Page{}, ErrInvalidQuery
	}
	if err != nil {
		return Page{}, fmt.Errorf("list recent activity: %w", err)
	}
	defer rows.Close()

	raw := make([]rawItem, 0, limit+1)
	for rows.Next() {
		var item rawItem
		if err := rows.Scan(&item.ID, &item.ActorID, &item.ActorUsername, &item.ActorName, &item.Action, &item.NodeID, &item.NodeName, &item.NodeKind, &item.ShareNodeID, &item.ShareNodeName, &item.ShareNodeKind, &item.ShareCollectionID, &item.ShareCollectionName, &item.ResourceUserID, &item.ResourceUsername, &item.ResourceName, &item.Metadata, &item.CreatedAt); err != nil {
			return Page{}, fmt.Errorf("scan recent activity: %w", err)
		}
		raw = append(raw, item)
	}
	if err := rows.Err(); err != nil {
		return Page{}, fmt.Errorf("read recent activity: %w", err)
	}

	hasMore := len(raw) > limit
	if hasMore {
		raw = raw[:limit]
	}
	items := make([]Item, 0, len(raw))
	for _, value := range raw {
		items = append(items, normalizeItem(value))
	}
	page := Page{Items: items}
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		page.NextCursor = &Cursor{BeforeAt: last.CreatedAt, BeforeID: last.ID}
	}
	return page, nil
}

func (s *Service) RecordSync(ctx context.Context, actor Actor, input SyncInput) error {
	if strings.TrimSpace(input.PairID) == "" || strings.TrimSpace(input.RemoteFolderID) == "" || strings.TrimSpace(input.RemoteFolderName) == "" || !validDirection(input.Direction) || !validSyncResult(input.Result) {
		return ErrInvalidQuery
	}
	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		return audit.Append(ctx, tx, audit.Event{ActorUserID: actor.UserID, Action: "sync.run", ResourceType: "user", ResourceID: actor.UserID, Metadata: map[string]any{
			"pairId": input.PairID, "remoteFolderId": input.RemoteFolderID, "remoteFolderName": input.RemoteFolderName, "direction": input.Direction, "result": input.Result,
		}})
	})
}

func normalizeOwnerID(actor Actor, requested string) (string, error) {
	requested = strings.TrimSpace(requested)
	if requested == "" {
		return actor.UserID, nil
	}
	if !actor.Admin && requested != actor.UserID {
		return "", ErrForbidden
	}
	return requested, nil
}

func normalizeItem(raw rawItem) Item {
	item := Item{ID: raw.ID, Action: raw.Action, Actor: Person{ID: raw.ActorID, Username: raw.ActorUsername, Name: raw.ActorName}, CreatedAt: raw.CreatedAt}
	switch {
	case raw.Action == "file.create" || raw.Action == "file.version.create":
		item.Kind, item.Target = "upload", nodeTarget(raw.NodeID, raw.NodeName, raw.NodeKind)
	case raw.Action == "node.rename":
		item.Kind, item.Target = "rename", nodeTarget(raw.NodeID, raw.NodeName, raw.NodeKind)
	case raw.Action == "node.move":
		item.Kind, item.Target = "move", nodeTarget(raw.NodeID, raw.NodeName, raw.NodeKind)
	case raw.Action == "node.trash":
		item.Kind, item.Target = "trash", nodeTarget(raw.NodeID, raw.NodeName, raw.NodeKind)
	case raw.Action == "node.restore":
		item.Kind, item.Target = "restore", nodeTarget(raw.NodeID, raw.NodeName, raw.NodeKind)
	case raw.Action == "share.create" || raw.Action == "share.update" || raw.Action == "share.revoke":
		item.Kind = "share"
		if raw.ShareNodeID != "" {
			item.Target = nodeTarget(raw.ShareNodeID, raw.ShareNodeName, raw.ShareNodeKind)
		} else {
			item.Target = Target{Type: "collection", ID: raw.ShareCollectionID, Name: raw.ShareCollectionName}
		}
	case raw.Action == "sync.run":
		item.Kind, item.Target = "sync", Target{Type: "folder", ID: metadataString(raw.Metadata, "remoteFolderId"), Name: metadataString(raw.Metadata, "remoteFolderName")}
		item.Detail = syncDetail(raw.Metadata)
	default:
		item.Kind, item.AdminOnly = "admin", true
		name := raw.ResourceName
		if name == "" {
			name = raw.ResourceUsername
		}
		item.Target = Target{Type: "user", ID: raw.ResourceUserID, Name: name}
	}
	return item
}

func nodeTarget(id, name, kind string) Target {
	if kind != "file" && kind != "folder" {
		kind = "node"
	}
	return Target{Type: kind, ID: id, Name: name}
}

func metadataString(raw json.RawMessage, key string) string {
	var value map[string]json.RawMessage
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	var result string
	_ = json.Unmarshal(value[key], &result)
	return result
}

func syncDetail(raw json.RawMessage) string {
	var metadata struct {
		Result SyncResult `json:"result"`
	}
	if json.Unmarshal(raw, &metadata) != nil {
		return ""
	}
	parts := make([]string, 0, 4)
	if metadata.Result.Uploaded > 0 {
		parts = append(parts, fmt.Sprintf("%d uploaded", metadata.Result.Uploaded))
	}
	if metadata.Result.Downloaded > 0 {
		parts = append(parts, fmt.Sprintf("%d downloaded", metadata.Result.Downloaded))
	}
	if metadata.Result.RemoteDeleted+metadata.Result.LocalDeleted > 0 {
		parts = append(parts, fmt.Sprintf("%d deleted", metadata.Result.RemoteDeleted+metadata.Result.LocalDeleted))
	}
	if metadata.Result.Conflicts > 0 {
		parts = append(parts, fmt.Sprintf("%d conflicts", metadata.Result.Conflicts))
	}
	if len(parts) == 0 {
		return "No file changes"
	}
	return strings.Join(parts, " · ")
}

func validDirection(value string) bool {
	return value == "two-way" || value == "download-only" || value == "upload-only"
}
func validSyncResult(value SyncResult) bool {
	return value.Uploaded >= 0 && value.Downloaded >= 0 && value.RemoteDeleted >= 0 && value.LocalDeleted >= 0 && value.Conflicts >= 0 && value.CreatedRemoteFolders >= 0 && value.CreatedLocalFolders >= 0 && value.Skipped >= 0
}
func isInvalidUUID(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "22P02"
}
