package files

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/postgres"
)

var ErrVersionNotFound = errors.New("file version not found")
var ErrVersionQuotaExceeded = errors.New("restoring this version exceeds storage quota")

type Version struct {
	ID                    string
	FileID                string
	Revision              int64
	Name                  string
	SizeBytes             int64
	ChunkSizeBytes        int64
	SHA256                []byte
	MIMEType              string
	Extension             string
	Category              string
	Width                 *int
	Height                *int
	DurationMS            *int64
	BitrateBPS            *int64
	Codec                 string
	Metadata              json.RawMessage
	MetadataStatus        string
	MetadataError         string
	CreatedBy             string
	RestoredFromVersionID string
	CreatedAt             time.Time
	IsCurrent             bool
}

type versionChunkSource struct{ service *Service }

func (s *Service) ListVersions(ctx context.Context, actor Actor, fileID string) ([]Version, error) {
	if _, err := s.Get(ctx, actor, fileID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, versionSelect+` WHERE v.file_id = $1::uuid ORDER BY v.revision DESC`, fileID)
	if err != nil {
		return nil, fmt.Errorf("list file versions: %w", err)
	}
	defer rows.Close()
	versions := make([]Version, 0)
	for rows.Next() {
		version, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read file versions: %w", err)
	}
	return versions, nil
}

func (s *Service) GetVersion(ctx context.Context, actor Actor, fileID, versionID string) (Version, error) {
	if _, err := s.Get(ctx, actor, fileID); err != nil {
		return Version{}, err
	}
	return s.getVersionStored(ctx, fileID, versionID)
}

func (s *Service) OpenVersion(ctx context.Context, actor Actor, fileID, versionID string, start, length int64) (Version, io.ReadCloser, error) {
	version, err := s.GetVersion(ctx, actor, fileID, versionID)
	if err != nil {
		return Version{}, nil, err
	}
	if start < 0 || length < 0 || start > version.SizeBytes || length > version.SizeBytes-start {
		return Version{}, nil, ErrInvalidSpan
	}
	if length == 0 {
		return version, io.NopCloser(&emptyReader{}), nil
	}
	if s.blobs == nil {
		return Version{}, nil, ErrStorageInvariant
	}
	reader, err := newRangeReader(ctx, versionChunkSource{s}, s.blobs, version.ID, version.ChunkSizeBytes, start, length)
	if err != nil {
		return Version{}, nil, err
	}
	return version, reader, nil
}

type emptyReader struct{}

func (*emptyReader) Read([]byte) (int, error) { return 0, io.EOF }

func (source versionChunkSource) chunkWindow(ctx context.Context, versionID string, start, end int) ([]chunk, error) {
	if start < 0 || end <= start {
		return nil, ErrStorageInvariant
	}
	rows, err := source.service.pool.Query(ctx, `
        SELECT fvc.part_index, fvc.part_size_bytes, c.sha256, c.discord_channel_id, c.discord_message_id, c.discord_attachment_id
        FROM file_version_chunks fvc
        JOIN chunks c ON c.id = fvc.chunk_id
        WHERE fvc.version_id = $1::uuid AND fvc.part_index >= $2 AND fvc.part_index < $3 AND c.status = 'ready'
        ORDER BY fvc.part_index
    `, versionID, start, end)
	if err != nil {
		return nil, fmt.Errorf("%w: load version chunk metadata: %v", ErrStorageInvariant, err)
	}
	defer rows.Close()
	window := make([]chunk, 0, end-start)
	expected := start
	for rows.Next() {
		var index int
		var item chunk
		var digest []byte
		if err := rows.Scan(&index, &item.SizeBytes, &digest, &item.Location.DiscordChannelID, &item.Location.DiscordMessageID, &item.Location.DiscordAttachmentID); err != nil {
			return nil, fmt.Errorf("%w: scan version chunk metadata: %v", ErrStorageInvariant, err)
		}
		if index != expected || len(digest) != len(item.SHA256) {
			return nil, ErrStorageInvariant
		}
		copy(item.SHA256[:], digest)
		window = append(window, item)
		expected++
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if expected != end {
		return nil, ErrStorageInvariant
	}
	return window, nil
}

func (s *Service) RestoreVersion(ctx context.Context, actor Actor, fileID, versionID string) (Version, error) {
	if _, err := s.GetEditable(ctx, actor, fileID); err != nil {
		return Version{}, err
	}
	var restored Version
	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		source, err := getVersionTx(ctx, tx, fileID, versionID)
		if err != nil {
			return err
		}
		var ownerID string
		var currentSize int64
		if err := tx.QueryRow(ctx, `SELECT n.owner_user_id::text, f.size_bytes FROM files f JOIN nodes n ON n.id=f.node_id WHERE f.node_id=$1::uuid FOR UPDATE OF f`, fileID).Scan(&ownerID, &currentSize); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		var quota *int64
		var used, reserved int64
		if err := tx.QueryRow(ctx, `SELECT storage_quota_bytes, storage_used_bytes, storage_reserved_bytes FROM users WHERE id=$1::uuid FOR UPDATE`, ownerID).Scan(&quota, &used, &reserved); err != nil {
			return err
		}
		if used < currentSize || source.SizeBytes > math.MaxInt64-(used-currentSize) {
			return ErrStorageInvariant
		}
		nextUsed := used - currentSize + source.SizeBytes
		if quota != nil && (nextUsed > *quota || reserved > *quota-nextUsed) {
			return ErrVersionQuotaExceeded
		}
		var revision int64
		if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(revision),0)+1 FROM file_versions WHERE file_id=$1::uuid`, fileID).Scan(&revision); err != nil {
			return err
		}
		var newVersionID string
		var newVersionCreatedAt time.Time
		err = tx.QueryRow(ctx, `
            INSERT INTO file_versions (file_id, revision, name, size_bytes, chunk_size_bytes, sha256, mime_type, extension, category, width, height, duration_ms, bitrate_bps, codec, metadata, metadata_status, metadata_error, created_by, restored_from_version_id)
            VALUES ($1::uuid,$2,$3,$4,$5,NULLIF($6,'\\x'::bytea),$7,NULLIF($8,''),$9,$10,$11,$12,$13,NULLIF($14,''),$15::jsonb,$16,NULLIF($17,''),$18::uuid,$19::uuid)
            RETURNING id::text, created_at
        `, fileID, revision, source.Name, source.SizeBytes, source.ChunkSizeBytes, source.SHA256, source.MIMEType, source.Extension, source.Category, source.Width, source.Height, source.DurationMS, source.BitrateBPS, source.Codec, source.Metadata, source.MetadataStatus, source.MetadataError, actor.UserID, source.ID).Scan(&newVersionID, &newVersionCreatedAt)
		if err != nil {
			return fmt.Errorf("create restored file version: %w", err)
		}
		restored = source
		restored.ID = newVersionID
		restored.CreatedAt = newVersionCreatedAt
		restored.Revision = revision
		restored.CreatedBy = actor.UserID
		restored.RestoredFromVersionID = source.ID
		restored.IsCurrent = true
		if _, err := tx.Exec(ctx, `INSERT INTO file_version_chunks (version_id,part_index,chunk_id,part_size_bytes) SELECT $1::uuid,part_index,chunk_id,part_size_bytes FROM file_version_chunks WHERE version_id=$2::uuid ORDER BY part_index`, restored.ID, source.ID); err != nil {
			return fmt.Errorf("copy restored version chunks: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM file_chunks WHERE file_id=$1::uuid`, fileID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO file_chunks (file_id,part_index,chunk_id,part_size_bytes) SELECT $1::uuid,part_index,chunk_id,part_size_bytes FROM file_version_chunks WHERE version_id=$2::uuid ORDER BY part_index`, fileID, restored.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE files SET current_version_id=$2::uuid,size_bytes=$3,chunk_size_bytes=$4,sha256=NULLIF($5,'\\x'::bytea),mime_type=$6,extension=NULLIF($7,''),category=$8,width=$9,height=$10,duration_ms=$11,bitrate_bps=$12,codec=NULLIF($13,''),metadata=$14::jsonb,metadata_status=$15,metadata_error=NULLIF($16,''),updated_at=now() WHERE node_id=$1::uuid`, fileID, restored.ID, source.SizeBytes, source.ChunkSizeBytes, source.SHA256, source.MIMEType, source.Extension, source.Category, source.Width, source.Height, source.DurationMS, source.BitrateBPS, source.Codec, source.Metadata, source.MetadataStatus, source.MetadataError); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE nodes SET updated_at=now() WHERE id=$1::uuid`, fileID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET storage_used_bytes=$2,updated_at=now() WHERE id=$1::uuid`, ownerID, nextUsed); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM file_thumbnails WHERE file_id=$1::uuid`, fileID); err != nil {
			return err
		}
		if source.MetadataStatus == "ready" && (source.Category == "image" || source.Category == "video") {
			if _, err := tx.Exec(ctx, `INSERT INTO file_thumbnails (file_id,variant,status) VALUES ($1::uuid,'grid','pending') ON CONFLICT (file_id,variant) DO UPDATE SET status='pending',storage_object_id=NULL,error=NULL,updated_at=now()`, fileID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO jobs (type,payload) VALUES ('file.thumbnail',jsonb_build_object('fileId',$1::text))`, fileID); err != nil {
				return err
			}
		}
		return audit.Append(ctx, tx, audit.Event{ActorUserID: actor.UserID, Action: "file.version.restore", ResourceType: "node", ResourceID: fileID, Metadata: map[string]any{"versionId": restored.ID, "revision": revision, "restoredFromVersionId": source.ID}})
	})
	if err != nil {
		return Version{}, err
	}
	restored.FileID = fileID
	return restored, nil
}

const versionSelect = `SELECT v.id::text,v.file_id::text,v.revision,v.name,v.size_bytes,v.chunk_size_bytes,v.sha256,v.mime_type,COALESCE(v.extension,''),v.category,v.width,v.height,v.duration_ms,v.bitrate_bps,COALESCE(v.codec,''),v.metadata,v.metadata_status,COALESCE(v.metadata_error,''),v.created_by::text,COALESCE(v.restored_from_version_id::text,''),v.created_at,(f.current_version_id=v.id) FROM file_versions v JOIN files f ON f.node_id=v.file_id`

func (s *Service) getVersionStored(ctx context.Context, fileID, versionID string) (Version, error) {
	return scanVersion(s.pool.QueryRow(ctx, versionSelect+` WHERE v.file_id=$1::uuid AND v.id=$2::uuid`, fileID, versionID))
}
func getVersionTx(ctx context.Context, tx pgx.Tx, fileID, versionID string) (Version, error) {
	return scanVersion(tx.QueryRow(ctx, versionSelect+` WHERE v.file_id=$1::uuid AND v.id=$2::uuid`, fileID, versionID))
}
func scanVersion(row interface{ Scan(...any) error }) (Version, error) {
	var v Version
	var metadata []byte
	err := row.Scan(&v.ID, &v.FileID, &v.Revision, &v.Name, &v.SizeBytes, &v.ChunkSizeBytes, &v.SHA256, &v.MIMEType, &v.Extension, &v.Category, &v.Width, &v.Height, &v.DurationMS, &v.BitrateBPS, &v.Codec, &metadata, &v.MetadataStatus, &v.MetadataError, &v.CreatedBy, &v.RestoredFromVersionID, &v.CreatedAt, &v.IsCurrent)
	if errors.Is(err, pgx.ErrNoRows) {
		return Version{}, ErrVersionNotFound
	}
	if err != nil {
		return Version{}, fmt.Errorf("load file version: %w", err)
	}
	v.Metadata = append(json.RawMessage(nil), metadata...)
	return v, nil
}

func (v Version) File() File {
	return File{ID: v.FileID, Name: v.Name, SizeBytes: v.SizeBytes, ChunkSizeBytes: v.ChunkSizeBytes, SHA256: v.SHA256, MIMEType: v.MIMEType, Extension: v.Extension, Category: v.Category, Width: v.Width, Height: v.Height, DurationMS: v.DurationMS, BitrateBPS: v.BitrateBPS, Codec: v.Codec, Metadata: v.Metadata, MetadataStatus: v.MetadataStatus, MetadataError: v.MetadataError, UpdatedAt: v.CreatedAt}
}
