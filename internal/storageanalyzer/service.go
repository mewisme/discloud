package storageanalyzer

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrForbidden    = errors.New("storage analyzer access denied")
	ErrInvalidQuery = errors.New("invalid storage analyzer query")
)

const (
	defaultLimit         = 10
	oldFileThresholdDays = 90
)

const ownerFilesCTE = `
	WITH RECURSIVE tree AS (
		SELECT n.id, n.parent_id, (n.deleted_at IS NOT NULL) AS trashed
		FROM nodes n
		WHERE n.owner_user_id = $1::uuid AND n.is_root

		UNION ALL

		SELECT child.id, child.parent_id, (parent.trashed OR child.deleted_at IS NOT NULL)
		FROM nodes child
		JOIN tree parent ON child.parent_id = parent.id
		WHERE child.owner_user_id = $1::uuid
	), scoped_files AS (
		SELECT n.id, n.name, f.size_bytes, f.category, f.mime_type, f.sha256, f.current_version_id, f.updated_at, tree.trashed
		FROM tree
		JOIN nodes n ON n.id = tree.id
		JOIN files f ON f.node_id = tree.id
	)
`

type Actor struct {
	UserID string
	Admin  bool
}

type Summary struct {
	LogicalBytes         int64 `json:"logicalBytes"`
	ReferencedChunkBytes int64 `json:"referencedChunkBytes"`
	FileCount            int64 `json:"fileCount"`
	TrashBytes           int64 `json:"trashBytes"`
	TrashFileCount       int64 `json:"trashFileCount"`
	VersionBytes         int64 `json:"versionBytes"`
}

type CategoryUsage struct {
	Category  string `json:"category"`
	Bytes     int64  `json:"bytes"`
	FileCount int64  `json:"fileCount"`
}

type FileItem struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	SizeBytes        int64     `json:"sizeBytes"`
	Category         string    `json:"category"`
	MIMEType         string    `json:"mimeType"`
	ContentUpdatedAt time.Time `json:"contentUpdatedAt"`
}

type OldFiles struct {
	ThresholdDays int        `json:"thresholdDays"`
	TotalBytes    int64      `json:"totalBytes"`
	TotalFiles    int64      `json:"totalFiles"`
	Items         []FileItem `json:"items"`
}

type DuplicateGroup struct {
	SHA256                string `json:"sha256"`
	SizeBytes             int64  `json:"sizeBytes"`
	FileCount             int64  `json:"fileCount"`
	DuplicateLogicalBytes int64  `json:"duplicateLogicalBytes"`
	SampleFileID          string `json:"sampleFileId"`
	SampleName            string `json:"sampleName"`
}

type Duplicates struct {
	GroupCount                 int64            `json:"groupCount"`
	TotalDuplicateLogicalBytes int64            `json:"totalDuplicateLogicalBytes"`
	Items                      []DuplicateGroup `json:"items"`
}

type Snapshot struct {
	Summary    Summary         `json:"summary"`
	Categories []CategoryUsage `json:"categories"`
	Largest    []FileItem      `json:"largest"`
	OldFiles   OldFiles        `json:"oldFiles"`
	Duplicates Duplicates      `json:"duplicates"`
}

type Service struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) Analyze(ctx context.Context, actor Actor, requestedOwnerID string) (Snapshot, error) {
	ownerID, err := normalizeOwnerID(actor, requestedOwnerID)
	if err != nil {
		return Snapshot{}, err
	}

	summary, err := s.summary(ctx, ownerID)
	if err != nil {
		return Snapshot{}, classifyDBError("load storage summary", err)
	}
	categories, err := s.categories(ctx, ownerID)
	if err != nil {
		return Snapshot{}, classifyDBError("load storage categories", err)
	}
	largest, err := s.largest(ctx, ownerID, defaultLimit)
	if err != nil {
		return Snapshot{}, classifyDBError("load largest files", err)
	}
	oldFiles, err := s.oldFiles(ctx, ownerID, defaultLimit)
	if err != nil {
		return Snapshot{}, classifyDBError("load old files", err)
	}
	duplicates, err := s.duplicates(ctx, ownerID, defaultLimit)
	if err != nil {
		return Snapshot{}, classifyDBError("load duplicate files", err)
	}

	return Snapshot{Summary: summary, Categories: categories, Largest: largest, OldFiles: oldFiles, Duplicates: duplicates}, nil
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

func (s *Service) summary(ctx context.Context, ownerID string) (Summary, error) {
	var result Summary
	err := s.pool.QueryRow(ctx, ownerFilesCTE+`
		, active AS (
			SELECT id, size_bytes, current_version_id FROM scoped_files WHERE NOT trashed
		), trash AS (
			SELECT id, size_bytes FROM scoped_files WHERE trashed
		), old_versions AS (
			SELECT fv.size_bytes
			FROM scoped_files sf
			JOIN file_versions fv ON fv.file_id = sf.id
			WHERE fv.id IS DISTINCT FROM sf.current_version_id
		), referenced_chunks AS (
			SELECT DISTINCT c.id, c.size_bytes
			FROM scoped_files sf
			JOIN file_versions fv ON fv.file_id = sf.id
			JOIN file_version_chunks fvc ON fvc.version_id = fv.id
			JOIN chunks c ON c.id = fvc.chunk_id
		)
		SELECT
			COALESCE((SELECT SUM(size_bytes) FROM active), 0)::bigint,
			COALESCE((SELECT SUM(size_bytes) FROM referenced_chunks), 0)::bigint,
			(SELECT COUNT(*) FROM active)::bigint,
			COALESCE((SELECT SUM(size_bytes) FROM trash), 0)::bigint,
			(SELECT COUNT(*) FROM trash)::bigint,
			COALESCE((SELECT SUM(size_bytes) FROM old_versions), 0)::bigint
	`, ownerID).Scan(&result.LogicalBytes, &result.ReferencedChunkBytes, &result.FileCount, &result.TrashBytes, &result.TrashFileCount, &result.VersionBytes)
	return result, err
}

func (s *Service) categories(ctx context.Context, ownerID string) ([]CategoryUsage, error) {
	rows, err := s.pool.Query(ctx, ownerFilesCTE+`
		SELECT category, COALESCE(SUM(size_bytes), 0)::bigint, COUNT(*)::bigint
		FROM scoped_files
		WHERE NOT trashed
		GROUP BY category
		ORDER BY SUM(size_bytes) DESC, category ASC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CategoryUsage, 0, 9)
	for rows.Next() {
		var item CategoryUsage
		if err := rows.Scan(&item.Category, &item.Bytes, &item.FileCount); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) largest(ctx context.Context, ownerID string, limit int) ([]FileItem, error) {
	rows, err := s.pool.Query(ctx, ownerFilesCTE+`
		SELECT sf.id::text, sf.name, sf.size_bytes, sf.category, sf.mime_type, COALESCE(fv.created_at, sf.updated_at)
		FROM scoped_files sf
		LEFT JOIN file_versions fv ON fv.id = sf.current_version_id
		WHERE NOT sf.trashed
		ORDER BY sf.size_bytes DESC, sf.id ASC
		LIMIT $2
	`, ownerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanFiles(rows)
}

func (s *Service) oldFiles(ctx context.Context, ownerID string, limit int) (OldFiles, error) {
	cutoff := time.Now().UTC().AddDate(0, 0, -oldFileThresholdDays)
	rows, err := s.pool.Query(ctx, ownerFilesCTE+`
		SELECT sf.id::text, sf.name, sf.size_bytes, sf.category, sf.mime_type, COALESCE(fv.created_at, sf.updated_at) AS content_updated_at,
			COUNT(*) OVER()::bigint, COALESCE(SUM(sf.size_bytes) OVER(), 0)::bigint
		FROM scoped_files sf
		LEFT JOIN file_versions fv ON fv.id = sf.current_version_id
		WHERE NOT sf.trashed AND COALESCE(fv.created_at, sf.updated_at) < $2
		ORDER BY content_updated_at ASC, sf.id ASC
		LIMIT $3
	`, ownerID, cutoff, limit)
	if err != nil {
		return OldFiles{}, err
	}
	defer rows.Close()
	result := OldFiles{ThresholdDays: oldFileThresholdDays, Items: make([]FileItem, 0, limit)}
	for rows.Next() {
		var item FileItem
		if err := rows.Scan(&item.ID, &item.Name, &item.SizeBytes, &item.Category, &item.MIMEType, &item.ContentUpdatedAt, &result.TotalFiles, &result.TotalBytes); err != nil {
			return OldFiles{}, err
		}
		result.Items = append(result.Items, item)
	}
	return result, rows.Err()
}

func (s *Service) duplicates(ctx context.Context, ownerID string, limit int) (Duplicates, error) {
	rows, err := s.pool.Query(ctx, ownerFilesCTE+`
		, groups AS (
			SELECT
				encode(sha256, 'hex') AS sha256,
				size_bytes,
				COUNT(*)::bigint AS file_count,
				((COUNT(*) - 1) * size_bytes)::bigint AS duplicate_logical_bytes,
				(array_agg(id::text ORDER BY id::text))[1] AS sample_file_id,
				(array_agg(name ORDER BY id::text))[1] AS sample_name
			FROM scoped_files
			WHERE NOT trashed AND sha256 IS NOT NULL
			GROUP BY sha256, size_bytes
			HAVING COUNT(*) > 1
		)
		SELECT sha256, size_bytes, file_count, duplicate_logical_bytes, sample_file_id, sample_name,
			COUNT(*) OVER()::bigint, COALESCE(SUM(duplicate_logical_bytes) OVER(), 0)::bigint
		FROM groups
		ORDER BY duplicate_logical_bytes DESC, sha256 ASC
		LIMIT $2
	`, ownerID, limit)
	if err != nil {
		return Duplicates{}, err
	}
	defer rows.Close()
	result := Duplicates{Items: make([]DuplicateGroup, 0, limit)}
	for rows.Next() {
		var item DuplicateGroup
		if err := rows.Scan(&item.SHA256, &item.SizeBytes, &item.FileCount, &item.DuplicateLogicalBytes, &item.SampleFileID, &item.SampleName, &result.GroupCount, &result.TotalDuplicateLogicalBytes); err != nil {
			return Duplicates{}, err
		}
		result.Items = append(result.Items, item)
	}
	return result, rows.Err()
}

func scanFiles(rows pgx.Rows) ([]FileItem, error) {
	items := make([]FileItem, 0, defaultLimit)
	for rows.Next() {
		var item FileItem
		if err := rows.Scan(&item.ID, &item.Name, &item.SizeBytes, &item.Category, &item.MIMEType, &item.ContentUpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func classifyDBError(operation string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "22P02" {
		return ErrInvalidQuery
	}
	return fmt.Errorf("%s: %w", operation, err)
}
