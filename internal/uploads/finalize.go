package uploads

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/postgres"
)

var (
	ErrIncompleteUpload = errors.New("upload parts are incomplete")
	ErrFileHashMismatch = errors.New("file SHA-256 mismatch")
)

type CompletedFile struct {
	ID             string
	OwnerUserID    string
	ParentFolderID string
	Name           string
	SizeBytes      int64
	ChunkSizeBytes int64
	SHA256         []byte
	MIMEType       string
	CreatedAt      time.Time
	VersionID      string
}

type Finalizer struct {
	service *Service
	blobs   blobstore.BlobStore
}

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func NewFinalizer(service *Service, blobs blobstore.BlobStore) *Finalizer {
	return &Finalizer{service: service, blobs: blobs}
}

func (f *Finalizer) Finalize(ctx context.Context, actor Actor, sessionID string) (CompletedFile, error) {
	if f.service == nil {
		return CompletedFile{}, ErrStorageUnavailable
	}

	session, err := f.service.Get(ctx, actor, sessionID)
	if err != nil {
		return CompletedFile{}, err
	}
	if session.Status == StatusCompleted {
		return loadCompletedFile(ctx, f.service.pool, session.CommittedFileID)
	}
	if session.Status != StatusOpen {
		return CompletedFile{}, ErrSessionClosed
	}
	if !time.Now().UTC().Before(session.ExpiresAt) {
		return CompletedFile{}, ErrSessionExpired
	}

	if err := f.validateParts(ctx, session); err != nil {
		return CompletedFile{}, err
	}

	var verifiedSHA256 []byte
	if len(session.FileSHA256) > 0 {
		if f.blobs == nil {
			return CompletedFile{}, ErrStorageUnavailable
		}

		hash, err := f.hashFile(ctx, session)
		if err != nil {
			return CompletedFile{}, err
		}
		if !equalDigest(hash, session.FileSHA256) {
			return CompletedFile{}, ErrFileHashMismatch
		}
		verifiedSHA256 = hash[:]
	}

	var file CompletedFile
	err = postgres.InTx(ctx, f.service.pool, func(tx pgx.Tx) error {
		session, err := loadSessionForUpdate(ctx, tx, sessionID)
		if err != nil {
			return err
		}
		if !actor.Admin && session.ActorUserID != actor.UserID {
			return ErrNotFound
		}
		if session.Status == StatusCompleted {
			file, err = loadCompletedFile(ctx, tx, session.CommittedFileID)
			return err
		}
		if session.Status != StatusOpen {
			return ErrSessionClosed
		}

		var active bool
		if err := tx.QueryRow(ctx, "SELECT now() < $1::timestamptz", session.ExpiresAt).Scan(&active); err != nil {
			return fmt.Errorf("check upload expiry: %w", err)
		}
		if !active {
			return ErrSessionExpired
		}
		if session.ReservedBytes != session.SizeBytes {
			return ErrQuotaInvariant
		}

		if err := lockOwnerTree(ctx, tx, session.OwnerUserID); err != nil {
			return err
		}
		if err := f.service.requireEdit(ctx, tx, actor, session.ParentFolderID); err != nil {
			return err
		}

		ownerID, err := loadParentOwner(ctx, tx, session.ParentFolderID)
		if err != nil {
			return err
		}
		if ownerID != session.OwnerUserID {
			return ErrQuotaInvariant
		}

		if err := validatePartsTx(ctx, tx, session); err != nil {
			return err
		}

		var used, reserved int64
		if err := tx.QueryRow(ctx, `
			SELECT storage_used_bytes, storage_reserved_bytes
			FROM users
			WHERE id::text = $1
			FOR UPDATE
		`, session.OwnerUserID).Scan(&used, &reserved); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return fmt.Errorf("lock upload owner quota: %w", err)
		}
		if reserved < session.ReservedBytes {
			return ErrQuotaInvariant
		}

		usedDelta := session.SizeBytes
		auditAction := "file.create"
		var versionID string
		if session.TargetFileID == "" {
			var createdAt time.Time
			err = tx.QueryRow(ctx, `INSERT INTO nodes (kind, owner_user_id, parent_id, name, name_key, created_by) VALUES ('file', $1::uuid, $2::uuid, $3, $4, $5::uuid) RETURNING id::text, created_at`, session.OwnerUserID, session.ParentFolderID, session.Name, session.NameKey, actor.UserID).Scan(&file.ID, &createdAt)
			if err != nil {
				if isFinalizeNameConflict(err) {
					return ErrNameConflict
				}
				return fmt.Errorf("create file node: %w", err)
			}
			file.OwnerUserID = session.OwnerUserID
			file.ParentFolderID = session.ParentFolderID
			file.Name = session.Name
			file.SizeBytes = session.SizeBytes
			file.ChunkSizeBytes = session.ChunkSizeBytes
			file.SHA256 = append([]byte(nil), verifiedSHA256...)
			file.MIMEType = "application/octet-stream"
			file.CreatedAt = createdAt
			if _, err := tx.Exec(ctx, `INSERT INTO files (node_id,size_bytes,chunk_size_bytes,sha256,mime_type) VALUES ($1::uuid,$2,$3,NULLIF($4,'\x'::bytea),$5)`, file.ID, file.SizeBytes, file.ChunkSizeBytes, verifiedSHA256, file.MIMEType); err != nil {
				return fmt.Errorf("create file metadata: %w", err)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO file_chunks (file_id,part_index,chunk_id,part_size_bytes) SELECT $1::uuid,part_index,chunk_id,part_size_bytes FROM upload_parts WHERE upload_id=$2::uuid ORDER BY part_index`, file.ID, session.ID); err != nil {
				return fmt.Errorf("create file chunks: %w", err)
			}
			err = tx.QueryRow(ctx, `INSERT INTO file_versions (file_id,revision,name,size_bytes,chunk_size_bytes,sha256,mime_type,created_by) VALUES ($1::uuid,1,$2,$3,$4,NULLIF($5,'\x'::bytea),$6,$7::uuid) RETURNING id::text`, file.ID, file.Name, file.SizeBytes, file.ChunkSizeBytes, verifiedSHA256, file.MIMEType, actor.UserID).Scan(&versionID)
			if err != nil {
				return fmt.Errorf("create initial file version: %w", err)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO file_version_chunks (version_id,part_index,chunk_id,part_size_bytes) SELECT $1::uuid,part_index,chunk_id,part_size_bytes FROM upload_parts WHERE upload_id=$2::uuid ORDER BY part_index`, versionID, session.ID); err != nil {
				return fmt.Errorf("create initial version chunks: %w", err)
			}
			if _, err := tx.Exec(ctx, `UPDATE files SET current_version_id=$2::uuid WHERE node_id=$1::uuid`, file.ID, versionID); err != nil {
				return err
			}
		} else {
			auditAction = "file.version.create"
			file.ID = session.TargetFileID
			var previousSize int64
			if err := tx.QueryRow(ctx, `SELECT n.owner_user_id::text,n.parent_id::text,n.name,f.size_bytes,n.created_at FROM nodes n JOIN files f ON f.node_id=n.id WHERE n.id=$1::uuid AND n.deleted_at IS NULL FOR UPDATE OF f`, file.ID).Scan(&file.OwnerUserID, &file.ParentFolderID, &file.Name, &previousSize, &file.CreatedAt); err != nil {
				return ErrNotFound
			}
			if file.OwnerUserID != session.OwnerUserID || file.ParentFolderID != session.ParentFolderID || file.Name != session.Name {
				return ErrQuotaInvariant
			}
			usedDelta = session.SizeBytes - previousSize
			if usedDelta > 0 && used > math.MaxInt64-usedDelta {
				return ErrQuotaInvariant
			}
			if usedDelta < 0 && used < -usedDelta {
				return ErrQuotaInvariant
			}
			var revision int64
			if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(revision),0)+1 FROM file_versions WHERE file_id=$1::uuid`, file.ID).Scan(&revision); err != nil {
				return err
			}
			file.SizeBytes = session.SizeBytes
			file.ChunkSizeBytes = session.ChunkSizeBytes
			file.SHA256 = append([]byte(nil), verifiedSHA256...)
			file.MIMEType = "application/octet-stream"
			err = tx.QueryRow(ctx, `INSERT INTO file_versions (file_id,revision,name,size_bytes,chunk_size_bytes,sha256,mime_type,created_by) VALUES ($1::uuid,$2,$3,$4,$5,NULLIF($6,'\x'::bytea),$7,$8::uuid) RETURNING id::text`, file.ID, revision, file.Name, file.SizeBytes, file.ChunkSizeBytes, verifiedSHA256, file.MIMEType, actor.UserID).Scan(&versionID)
			if err != nil {
				return fmt.Errorf("create file version: %w", err)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO file_version_chunks (version_id,part_index,chunk_id,part_size_bytes) SELECT $1::uuid,part_index,chunk_id,part_size_bytes FROM upload_parts WHERE upload_id=$2::uuid ORDER BY part_index`, versionID, session.ID); err != nil {
				return fmt.Errorf("create version chunks: %w", err)
			}
			if _, err := tx.Exec(ctx, `DELETE FROM file_chunks WHERE file_id=$1::uuid`, file.ID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO file_chunks (file_id,part_index,chunk_id,part_size_bytes) SELECT $1::uuid,part_index,chunk_id,part_size_bytes FROM upload_parts WHERE upload_id=$2::uuid ORDER BY part_index`, file.ID, session.ID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE files SET current_version_id=$2::uuid,size_bytes=$3,chunk_size_bytes=$4,sha256=NULLIF($5,'\x'::bytea),mime_type=$6,extension=NULL,category='binary',width=NULL,height=NULL,duration_ms=NULL,bitrate_bps=NULL,codec=NULL,metadata='{}'::jsonb,metadata_status='pending',metadata_error=NULL,updated_at=now() WHERE node_id=$1::uuid`, file.ID, versionID, file.SizeBytes, file.ChunkSizeBytes, verifiedSHA256, file.MIMEType); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE nodes SET updated_at=now() WHERE id=$1::uuid`, file.ID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM file_thumbnails WHERE file_id=$1::uuid`, file.ID); err != nil {
				return err
			}
		}
		file.VersionID = versionID

		if _, err := tx.Exec(ctx, `
			UPDATE chunks
			SET status = 'ready', committed_at = COALESCE(committed_at, now())
			WHERE id IN (
				SELECT chunk_id
				FROM upload_parts
				WHERE upload_id = $1::uuid
			)
		`, session.ID); err != nil {
			return fmt.Errorf("commit chunks: %w", err)
		}

		if _, err := tx.Exec(ctx, `
			UPDATE users
			SET storage_reserved_bytes = storage_reserved_bytes - $2,
			    storage_used_bytes = storage_used_bytes + $3,
			    updated_at = now()
			WHERE id::text = $1
		`, session.OwnerUserID, session.ReservedBytes, usedDelta); err != nil {
			return fmt.Errorf("commit upload quota: %w", err)
		}

		if _, err := tx.Exec(ctx, `
			UPDATE upload_sessions
			SET status = 'completed',
			    committed_file_id = $2::uuid,
			    completed_at = now(),
			    closed_at = now(),
			    updated_at = now()
			WHERE id = $1::uuid
		`, session.ID, file.ID); err != nil {
			return fmt.Errorf("complete upload session: %w", err)
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO jobs (type, payload)
			VALUES (
				'file.metadata',
				jsonb_build_object(
					'fileId', $1::text,
					'mimeTypeHint', NULLIF($2, ''),
					'versionId', $3::text
				)
			)
		`, file.ID, strings.TrimSpace(session.MIMETypeHint), file.VersionID); err != nil {
			return fmt.Errorf("enqueue file metadata job: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actor.UserID,
			Action:       auditAction,
			ResourceType: "node",
			ResourceID:   file.ID,
			Metadata: map[string]any{
				"sizeBytes": session.SizeBytes,
				"uploadId":  session.ID,
				"versionId": file.VersionID,
			},
		})
	})
	if err != nil {
		return CompletedFile{}, err
	}

	return file, nil
}

func (f *Finalizer) validateParts(ctx context.Context, session Session) error {
	return validatePartsQuery(ctx, f.service.pool, session)
}

func validatePartsTx(ctx context.Context, tx pgx.Tx, session Session) error {
	return validatePartsQuery(ctx, tx, session)
}

func validatePartsQuery(ctx context.Context, db queryRower, session Session) error {
	var count int
	var total int64
	var valid bool

	err := db.QueryRow(ctx, `
		SELECT
			count(*),
			COALESCE(sum(part_size_bytes), 0),
			COALESCE(bool_and(
				part_index >= 0
				AND part_index < $2
				AND part_size_bytes = CASE
					WHEN part_index < $2 - 1 THEN $3
					ELSE $4 - part_index * $3
				END
			), true)
		FROM upload_parts
		WHERE upload_id = $1::uuid
	`, session.ID, session.ExpectedParts, session.ChunkSizeBytes, session.SizeBytes).Scan(&count, &total, &valid)
	if err != nil {
		return fmt.Errorf("validate upload parts: %w", err)
	}
	if count != session.ExpectedParts || total != session.SizeBytes || !valid {
		return ErrIncompleteUpload
	}
	return nil
}

func (f *Finalizer) hashFile(ctx context.Context, session Session) ([32]byte, error) {
	hash := sha256.New()

	rows, err := f.service.pool.Query(ctx, `
		SELECT
			up.part_index,
			up.part_size_bytes,
			c.discord_channel_id,
			c.discord_message_id,
			c.discord_attachment_id
		FROM upload_parts up
		JOIN chunks c ON c.id = up.chunk_id
		WHERE up.upload_id::text = $1
		ORDER BY up.part_index
	`, session.ID)
	if err != nil {
		return [32]byte{}, fmt.Errorf("list upload chunks: %w", err)
	}
	defer rows.Close()

	index := 0
	var total int64

	for rows.Next() {
		var partIndex int
		var size int64
		var location blobstore.ChunkLocation
		if err := rows.Scan(
			&partIndex,
			&size,
			&location.DiscordChannelID,
			&location.DiscordMessageID,
			&location.DiscordAttachmentID,
		); err != nil {
			return [32]byte{}, fmt.Errorf("scan upload chunk: %w", err)
		}
		if partIndex != index {
			return [32]byte{}, ErrIncompleteUpload
		}

		reader, err := f.blobs.OpenChunk(ctx, location, 0, size)
		if err != nil {
			return [32]byte{}, err
		}

		n, copyErr := io.Copy(hash, io.LimitReader(reader, size+1))
		closeErr := reader.Close()
		if copyErr != nil {
			return [32]byte{}, fmt.Errorf("hash upload chunk: %w", copyErr)
		}
		if closeErr != nil {
			return [32]byte{}, fmt.Errorf("close upload chunk: %w", closeErr)
		}
		if n != size {
			return [32]byte{}, ErrStorageInvariant
		}

		total += n
		index++
	}

	if err := rows.Err(); err != nil {
		return [32]byte{}, fmt.Errorf("read upload chunks: %w", err)
	}
	if index != session.ExpectedParts || total != session.SizeBytes {
		return [32]byte{}, ErrIncompleteUpload
	}

	var digest [32]byte
	copy(digest[:], hash.Sum(nil))
	return digest, nil
}

func loadCompletedFile(ctx context.Context, db queryRower, fileID string) (CompletedFile, error) {
	var file CompletedFile
	err := db.QueryRow(ctx, `
		SELECT
			n.id::text,
			n.owner_user_id::text,
			n.parent_id::text,
			n.name,
			f.size_bytes,
			f.chunk_size_bytes,
			f.sha256,
			f.mime_type,
			n.created_at
		FROM nodes n
		JOIN files f ON f.node_id = n.id
		WHERE n.id::text = $1
	`, fileID).Scan(
		&file.ID,
		&file.OwnerUserID,
		&file.ParentFolderID,
		&file.Name,
		&file.SizeBytes,
		&file.ChunkSizeBytes,
		&file.SHA256,
		&file.MIMEType,
		&file.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return CompletedFile{}, ErrNotFound
	}
	if err != nil {
		return CompletedFile{}, fmt.Errorf("load completed file: %w", err)
	}
	return file, nil
}

func equalDigest(actual [32]byte, expected []byte) bool {
	if len(expected) != len(actual) {
		return false
	}
	for i := range actual {
		if actual[i] != expected[i] {
			return false
		}
	}
	return true
}

func isFinalizeNameConflict(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
