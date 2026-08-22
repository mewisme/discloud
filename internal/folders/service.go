package folders

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/files"
)

var (
	ErrNotFound         = errors.New("folder not found")
	ErrArchiveInvariant = errors.New("folder archive invariant violated")
	ErrArchiveTooLarge  = errors.New("folder archive exceeds resource limits")
)

type Actor struct {
	UserID string
	Admin  bool
}

type ArchiveLimits struct {
	MaxEntries int
	MaxBytes   int64
}

type ArchiveEntry struct {
	NodeID    string
	Path      string
	Kind      string
	SizeBytes int64
	CreatedAt time.Time
}

type Archive struct {
	Filename  string
	Entries   []ArchiveEntry
	NodeCount int
}

type fileOpener interface {
	Open(context.Context, files.Actor, string, int64, int64) (files.File, io.ReadCloser, error)
}

type storedFileOpener interface {
	OpenStored(context.Context, string, int64, int64) (files.File, io.ReadCloser, error)
}

type Service struct {
	pool   *pgxpool.Pool
	acl    *acl.Service
	files  fileOpener
	stored storedFileOpener
}

type treeNode struct {
	ID        string
	ParentID  string
	Kind      string
	Name      string
	SizeBytes *int64
	CreatedAt time.Time
}

func New(pool *pgxpool.Pool, fileService *files.Service) *Service {
	return &Service{
		pool:   pool,
		acl:    acl.New(pool),
		files:  fileService,
		stored: fileService,
	}
}

func (s *Service) PrepareArchive(ctx context.Context, actor Actor, folderID string) (Archive, error) {
	level, err := s.acl.Resolve(ctx, folderID, actor.UserID, actor.Admin)
	if errors.Is(err, acl.ErrNotFound) || level == acl.None {
		return Archive{}, ErrNotFound
	}
	if err != nil {
		return Archive{}, err
	}
	return s.prepareArchive(ctx, folderID)
}

// PrepareArchiveStored skips ACL; caller must authorize another access context first.
func (s *Service) PrepareArchiveStored(ctx context.Context, folderID string) (Archive, error) {
	return s.prepareArchive(ctx, folderID)
}

// PrepareArchiveStoredLimited skips ACL and enforces bounded archive work.
// The caller must authorize another access context first.
func (s *Service) PrepareArchiveStoredLimited(ctx context.Context, folderID string, limits ArchiveLimits) (Archive, error) {
	if err := validateArchiveLimits(limits); err != nil {
		return Archive{}, err
	}
	if err := s.checkArchiveLimits(ctx, folderID, limits); err != nil {
		return Archive{}, err
	}

	archive, err := s.prepareArchive(ctx, folderID)
	if err != nil {
		return Archive{}, err
	}
	if err := validatePreparedArchiveLimits(archive, limits); err != nil {
		return Archive{}, err
	}
	return archive, nil
}

func (s *Service) checkArchiveLimits(ctx context.Context, folderID string, limits ArchiveLimits) error {
	rows, err := s.pool.Query(ctx, `
		WITH RECURSIVE tree AS (
			SELECT id, kind
			FROM nodes
			WHERE id = $1::uuid
			  AND kind = 'folder'
			  AND deleted_at IS NULL

			UNION ALL

			SELECT n.id, n.kind
			FROM nodes n
			JOIN tree ON n.parent_id = tree.id
			WHERE n.deleted_at IS NULL
		)
		SELECT tree.kind, f.size_bytes
		FROM tree
		LEFT JOIN files f ON f.node_id = tree.id
		LIMIT $2
	`, folderID, limits.MaxEntries+1)
	if err != nil {
		return fmt.Errorf("check folder archive limits: %w", err)
	}
	defer rows.Close()

	count := 0
	var totalBytes int64

	for rows.Next() {
		var (
			kind string
			size *int64
		)
		if err := rows.Scan(&kind, &size); err != nil {
			return fmt.Errorf("scan folder archive limits: %w", err)
		}

		count++
		if count > limits.MaxEntries {
			return ErrArchiveTooLarge
		}

		if kind != "file" {
			continue
		}
		if size == nil || *size < 0 {
			return ErrArchiveInvariant
		}
		if *size > limits.MaxBytes-totalBytes {
			return ErrArchiveTooLarge
		}
		totalBytes += *size
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("read folder archive limits: %w", err)
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) prepareArchive(ctx context.Context, folderID string) (Archive, error) {
	rows, err := s.pool.Query(ctx, `
		WITH RECURSIVE tree AS (
			SELECT id, parent_id, kind, name, name_key, created_at, 0 AS depth
			FROM nodes
			WHERE id = $1::uuid
			  AND kind = 'folder'
			  AND deleted_at IS NULL

			UNION ALL

			SELECT n.id, n.parent_id, n.kind, n.name, n.name_key, n.created_at, tree.depth + 1
			FROM nodes n
			JOIN tree ON n.parent_id = tree.id
			WHERE n.deleted_at IS NULL
		)
		SELECT
			tree.id::text,
			COALESCE(tree.parent_id::text, ''),
			tree.kind,
			tree.name,
			f.size_bytes,
			tree.created_at
		FROM tree
		LEFT JOIN files f ON f.node_id = tree.id
		ORDER BY tree.depth, tree.parent_id, tree.name_key, tree.id
	`, folderID)
	if err != nil {
		return Archive{}, fmt.Errorf("query folder archive: %w", err)
	}
	defer rows.Close()

	nodes := make([]treeNode, 0)
	for rows.Next() {
		var node treeNode
		if err := rows.Scan(
			&node.ID,
			&node.ParentID,
			&node.Kind,
			&node.Name,
			&node.SizeBytes,
			&node.CreatedAt,
		); err != nil {
			return Archive{}, fmt.Errorf("scan folder archive: %w", err)
		}
		nodes = append(nodes, node)
	}
	if err := rows.Err(); err != nil {
		return Archive{}, fmt.Errorf("read folder archive: %w", err)
	}
	if len(nodes) == 0 || nodes[0].ID != folderID {
		return Archive{}, ErrNotFound
	}

	// ponytail: keep tree metadata in memory; page when huge trees become a measured problem.
	return buildArchive(nodes)
}

func buildArchive(nodes []treeNode) (Archive, error) {
	if len(nodes) == 0 {
		return Archive{}, ErrArchiveInvariant
	}

	root := nodes[0]
	base := ""
	if root.Name != "" {
		var err error
		base, err = sanitizeArchiveSegment(root.Name)
		if err != nil {
			return Archive{}, err
		}
	}

	filename := "files.zip"
	if base != "" {
		filename = base + ".zip"
	}

	archive := Archive{
		Filename:  filename,
		Entries:   make([]ArchiveEntry, 0, len(nodes)),
		NodeCount: len(nodes),
	}
	paths := map[string]string{root.ID: base}
	used := make(map[string]map[string]struct{})

	if base != "" {
		archive.Entries = append(archive.Entries, ArchiveEntry{
			NodeID: root.ID, Path: base, Kind: "folder", CreatedAt: root.CreatedAt,
		})
	}

	for _, node := range nodes[1:] {
		parentPath, ok := paths[node.ParentID]
		if !ok {
			return Archive{}, ErrArchiveInvariant
		}

		file := node.Kind == "file"
		if !file && node.Kind != "folder" {
			return Archive{}, ErrArchiveInvariant
		}
		if file && node.SizeBytes == nil {
			return Archive{}, ErrArchiveInvariant
		}

		segment, err := sanitizeArchiveSegment(node.Name)
		if err != nil {
			return Archive{}, err
		}

		if used[node.ParentID] == nil {
			used[node.ParentID] = make(map[string]struct{})
		}
		segment = uniqueArchiveSegment(used[node.ParentID], segment, file)

		archivePath := segment
		if parentPath != "" {
			archivePath = parentPath + "/" + segment
		}
		paths[node.ID] = archivePath

		var size int64
		if node.SizeBytes != nil {
			size = *node.SizeBytes
		}
		archive.Entries = append(archive.Entries, ArchiveEntry{
			NodeID: node.ID, Path: archivePath, Kind: node.Kind,
			SizeBytes: size, CreatedAt: node.CreatedAt,
		})
	}

	return archive, nil
}

func validateArchiveLimits(limits ArchiveLimits) error {
	if limits.MaxEntries < 1 || limits.MaxBytes < 0 {
		return ErrArchiveInvariant
	}
	return nil
}

func validatePreparedArchiveLimits(archive Archive, limits ArchiveLimits) error {
	if err := validateArchiveLimits(limits); err != nil {
		return err
	}
	if archive.NodeCount < 1 {
		return ErrArchiveInvariant
	}
	if archive.NodeCount > limits.MaxEntries {
		return ErrArchiveTooLarge
	}

	var totalBytes int64
	for _, entry := range archive.Entries {
		if entry.Kind != "file" {
			continue
		}
		if entry.SizeBytes < 0 {
			return ErrArchiveInvariant
		}
		if entry.SizeBytes > limits.MaxBytes-totalBytes {
			return ErrArchiveTooLarge
		}
		totalBytes += entry.SizeBytes
	}
	return nil
}
