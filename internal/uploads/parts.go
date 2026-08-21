package uploads

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/chunks"
	"github.com/mewisme/discloud/internal/postgres"
)

var (
	ErrPartConflict       = errors.New("upload part already exists with different content")
	ErrPartHashMismatch   = errors.New("upload part SHA-256 mismatch")
	ErrPartSizeMismatch   = errors.New("upload part size mismatch")
	ErrStorageUnavailable = errors.New("upload storage unavailable")
	ErrStorageInvariant   = errors.New("upload storage invariant violated")
	errPartNotFound       = errors.New("upload part not found")
)

type Part struct {
	UploadID  string
	PartIndex int
	ChunkID   string
	SizeBytes int64
	SHA256    [32]byte
	CreatedAt time.Time
}

type PutPartResult struct {
	Part         Part
	Deduplicated bool
}

type PartUploader struct {
	service *Service
	chunks  *chunks.Repository
	blobs   blobstore.AttemptBlobStore
}

func NewPartUploader(service *Service, blobs blobstore.AttemptBlobStore) *PartUploader {
	if service == nil {
		return &PartUploader{blobs: blobs}
	}
	return &PartUploader{service: service, chunks: chunks.New(service.pool), blobs: blobs}
}

func (u *PartUploader) PutPart(ctx context.Context, actor Actor, sessionID string, partIndex int, expectedSHA256 [32]byte, src io.Reader) (PutPartResult, error) {
	if u.service == nil || u.chunks == nil || u.blobs == nil || src == nil {
		return PutPartResult{}, ErrStorageUnavailable
	}

	session, err := u.service.Get(ctx, actor, sessionID)
	if err != nil {
		return PutPartResult{}, err
	}

	size, err := validatePartSession(session, partIndex)
	if err != nil {
		return PutPartResult{}, err
	}

	if part, err := u.getPart(ctx, session.ID, partIndex); err == nil {
		if part.SizeBytes == size && part.SHA256 == expectedSHA256 {
			return PutPartResult{Part: part, Deduplicated: true}, nil
		}
		return PutPartResult{}, ErrPartConflict
	} else if !errors.Is(err, errPartNotFound) {
		return PutPartResult{}, err
	}

	file, err := spoolPart(src, size, expectedSHA256)
	if err != nil {
		return PutPartResult{}, err
	}
	defer func() {
		file.Close()
		os.Remove(file.Name())
	}()

	var result PutPartResult
	err = u.chunks.WithDigestLock(ctx, expectedSHA256, size, func() error {
		current, err := u.service.Get(ctx, actor, session.ID)
		if err != nil {
			return err
		}

		currentSize, err := validatePartSession(current, partIndex)
		if err != nil {
			return err
		}
		if currentSize != size {
			return ErrPartSizeMismatch
		}

		if part, err := u.getPart(ctx, current.ID, partIndex); err == nil {
			if part.SizeBytes != size || part.SHA256 != expectedSHA256 {
				return ErrPartConflict
			}
			result = PutPartResult{Part: part, Deduplicated: true}
			return nil
		} else if !errors.Is(err, errPartNotFound) {
			return err
		}

		if chunk, err := u.chunks.FindByDigest(ctx, expectedSHA256, size); err == nil {
			part, err := u.attachPart(
				ctx,
				actor,
				current.ID,
				partIndex,
				chunk.ID,
				size,
				expectedSHA256,
			)
			if err != nil {
				return err
			}
			result = PutPartResult{Part: part, Deduplicated: true}
			return nil
		} else if !errors.Is(err, chunks.ErrNotFound) {
			return err
		}

		for {
			excluded, err := u.service.UsedBotIDs(ctx, current.ID, partIndex)
			if err != nil {
				return err
			}
			if len(excluded) >= MaxDistinctChunkUploadAttempts {
				return ErrAttemptsExhausted
			}

			partIndexValue := partIndex

			botUserID, releaseBot, err := acquireUploadBot(
				ctx,
				u.blobs,
				excluded,
				blobstore.LeaseMetadata{
					Operation: blobstore.LeaseOperationUpload,
					UploadID:  current.ID,
					FileName:  current.Name,
					PartIndex: &partIndexValue,
					SizeBytes: size,
				},
			)
			if err != nil {
				return err
			}

			attempt, err := u.service.StartAttempt(ctx, current.ID, partIndex, botUserID)
			if errors.Is(err, ErrBotAlreadyTried) {
				releaseBot()
				continue
			}
			if err != nil {
				releaseBot()
				return err
			}

			if _, err := file.Seek(0, io.SeekStart); err != nil {
				releaseBot()
				return fmt.Errorf("rewind upload part: %w", err)
			}

			put, err := u.blobs.PutChunkWithBot(ctx, botUserID, file, size, expectedSHA256)
			releaseBot()
			if err != nil {
				class, retryable := blobstore.Classify(err)
				if finishErr := u.service.FinishAttempt(
					ctx,
					attempt.ID,
					AttemptFailed,
					class,
					err.Error(),
				); finishErr != nil {
					return finishErr
				}
				if !retryable {
					return err
				}
				continue
			}

			if put.BotUserID != botUserID {
				_ = u.service.FinishAttempt(
					ctx,
					attempt.ID,
					AttemptFailed,
					"protocol",
					"storage returned unexpected bot",
				)
				return ErrStorageInvariant
			}

			registration, err := u.chunks.Register(
				ctx,
				expectedSHA256,
				size,
				put.Location,
			)
			if err != nil {
				return err
			}

			if !registration.Created && registration.Chunk.Location != put.Location {
				if cleaner, ok := u.blobs.(blobstore.TechnicalBlobStore); ok {
					_ = cleaner.DeleteChunk(ctx, put.Location)
				}
			}

			if err := u.service.FinishAttempt(
				ctx,
				attempt.ID,
				AttemptSucceeded,
				"",
				"",
			); err != nil {
				return err
			}

			part, err := u.attachPart(
				ctx,
				actor,
				current.ID,
				partIndex,
				registration.Chunk.ID,
				size,
				expectedSHA256,
			)
			if err != nil {
				return err
			}

			result = PutPartResult{
				Part:         part,
				Deduplicated: !registration.Created,
			}
			return nil
		}
	})
	if err != nil {
		return PutPartResult{}, err
	}

	return result, nil
}

func (u *PartUploader) getPart(ctx context.Context, uploadID string, partIndex int) (Part, error) {
	part, err := scanPart(u.service.pool.QueryRow(ctx, `
		SELECT upload_id::text, part_index, chunk_id::text, part_size_bytes, sha256, created_at
		FROM upload_parts
		WHERE upload_id::text = $1 AND part_index = $2
	`, uploadID, partIndex))
	if errors.Is(err, pgx.ErrNoRows) {
		return Part{}, errPartNotFound
	}
	if err != nil {
		return Part{}, fmt.Errorf("get upload part: %w", err)
	}
	return part, nil
}

func (u *PartUploader) attachPart(ctx context.Context, actor Actor, uploadID string, partIndex int, chunkID string, size int64, digest [32]byte) (Part, error) {
	var part Part

	err := postgres.InTx(ctx, u.service.pool, func(tx pgx.Tx) error {
		session, err := loadSessionForUpdate(ctx, tx, uploadID)
		if err != nil {
			return err
		}
		if !actor.Admin && session.ActorUserID != actor.UserID {
			return ErrNotFound
		}

		expectedSize, err := validatePartSession(session, partIndex)
		if err != nil {
			return err
		}
		if expectedSize != size {
			return ErrPartSizeMismatch
		}

		existing, err := scanPart(tx.QueryRow(ctx, `
			SELECT upload_id::text, part_index, chunk_id::text, part_size_bytes, sha256, created_at
			FROM upload_parts
			WHERE upload_id = $1::uuid AND part_index = $2
		`, uploadID, partIndex))
		if err == nil {
			if existing.SizeBytes == size && existing.SHA256 == digest {
				part = existing
				return nil
			}
			return ErrPartConflict
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("check upload part: %w", err)
		}

		part, err = scanPart(tx.QueryRow(ctx, `
			INSERT INTO upload_parts (
				upload_id,
				part_index,
				chunk_id,
				part_size_bytes,
				sha256
			)
			VALUES ($1::uuid, $2, $3::uuid, $4, $5)
			RETURNING upload_id::text, part_index, chunk_id::text, part_size_bytes, sha256, created_at
		`, uploadID, partIndex, chunkID, size, digest[:]))
		if err != nil {
			return fmt.Errorf("attach upload part: %w", err)
		}
		return nil
	})
	if err != nil {
		return Part{}, err
	}

	return part, nil
}

func validatePartSession(session Session, partIndex int) (int64, error) {
	if session.Status != StatusOpen {
		return 0, ErrSessionClosed
	}
	if !time.Now().UTC().Before(session.ExpiresAt) {
		return 0, ErrSessionExpired
	}
	return expectedPartSize(session, partIndex)
}

func expectedPartSize(session Session, partIndex int) (int64, error) {
	if partIndex < 0 || partIndex >= session.ExpectedParts {
		return 0, ErrInvalidPart
	}
	if partIndex < session.ExpectedParts-1 {
		return session.ChunkSizeBytes, nil
	}
	return session.SizeBytes - int64(partIndex)*session.ChunkSizeBytes, nil
}

func spoolPart(src io.Reader, size int64, expectedSHA256 [32]byte) (*os.File, error) {
	file, err := os.CreateTemp("", "discloud-part-*")
	if err != nil {
		return nil, fmt.Errorf("create upload part spool: %w", err)
	}

	cleanup := func() {
		file.Close()
		os.Remove(file.Name())
	}

	hash := sha256.New()
	n, err := io.CopyN(io.MultiWriter(file, hash), src, size)
	if err != nil {
		cleanup()
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, fmt.Errorf("%w: got %d bytes, want %d", ErrPartSizeMismatch, n, size)
		}
		return nil, fmt.Errorf("read upload part: %w", err)
	}

	var extra [1]byte
	extraN, extraErr := io.ReadFull(src, extra[:])
	if extraN > 0 {
		cleanup()
		return nil, fmt.Errorf("%w: exceeds %d bytes", ErrPartSizeMismatch, size)
	}
	if extraErr != nil &&
		!errors.Is(extraErr, io.EOF) &&
		!errors.Is(extraErr, io.ErrUnexpectedEOF) {
		cleanup()
		return nil, fmt.Errorf("read upload part tail: %w", extraErr)
	}

	var actual [32]byte
	copy(actual[:], hash.Sum(nil))
	if actual != expectedSHA256 {
		cleanup()
		return nil, ErrPartHashMismatch
	}

	if _, err := file.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, fmt.Errorf("rewind upload part: %w", err)
	}
	return file, nil
}

func scanPart(row scanner) (Part, error) {
	var part Part
	var digest []byte

	if err := row.Scan(
		&part.UploadID,
		&part.PartIndex,
		&part.ChunkID,
		&part.SizeBytes,
		&digest,
		&part.CreatedAt,
	); err != nil {
		return Part{}, err
	}
	if len(digest) != len(part.SHA256) {
		return Part{}, fmt.Errorf("invalid stored part SHA-256 length %d", len(digest))
	}
	copy(part.SHA256[:], digest)
	return part, nil
}

func acquireUploadBot(
	ctx context.Context,
	store blobstore.AttemptBlobStore,
	excluded []string,
	metadata blobstore.LeaseMetadata,
) (string, func(), error) {
	if leased, ok := store.(blobstore.UploadLeaseMetadataStore); ok {
		return leased.AcquireUploadBotFor(
			ctx,
			excluded,
			metadata,
		)
	}

	if leased, ok := store.(blobstore.UploadLeaseStore); ok {
		return leased.AcquireUploadBot(ctx, excluded)
	}

	botUserID, err := store.SelectUploadBot(excluded)
	return botUserID, func() {}, err
}
