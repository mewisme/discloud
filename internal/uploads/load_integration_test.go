package uploads

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/mewisme/discloud/internal/blobstore/fake"
	filestore "github.com/mewisme/discloud/internal/files"
)

func TestLoadConcurrentSmallUploads(t *testing.T) {
	requireUploadLoadTest(t)

	runConcurrentUploadLoad(
		t,
		"small",
		uploadLoadInt("DISCLOUD_LOAD_SMALL_FILES", 64),
		int64(uploadLoadInt("DISCLOUD_LOAD_SMALL_KIB", 64))*1024,
		int64(uploadLoadInt("DISCLOUD_LOAD_SMALL_CHUNK_KIB", 64))*1024,
		uploadLoadInt("DISCLOUD_LOAD_SMALL_CONCURRENCY", 16),
	)
}

func TestLoadConcurrentLargeUploads(t *testing.T) {
	requireUploadLoadTest(t)

	runConcurrentUploadLoad(
		t,
		"large",
		uploadLoadInt("DISCLOUD_LOAD_LARGE_FILES", 4),
		int64(uploadLoadInt("DISCLOUD_LOAD_LARGE_MIB", 16))*1024*1024,
		int64(uploadLoadInt("DISCLOUD_LOAD_LARGE_CHUNK_MIB", 2))*1024*1024,
		uploadLoadInt("DISCLOUD_LOAD_LARGE_CONCURRENCY", 4),
	)
}

func TestLoadRangeHeavyReads(t *testing.T) {
	requireUploadLoadTest(t)

	ctx, pool := openUploadTestPool(t)
	userID, rootID := createUploadUser(
		t,
		ctx,
		pool,
		"range-load-owner",
		nil,
	)

	fileSize := int64(
		uploadLoadInt("DISCLOUD_LOAD_RANGE_FILE_MIB", 32),
	) * 1024 * 1024

	chunkSize := int64(
		uploadLoadInt("DISCLOUD_LOAD_RANGE_CHUNK_MIB", 4),
	) * 1024 * 1024

	rangeSize := int64(
		uploadLoadInt("DISCLOUD_LOAD_RANGE_KIB", 512),
	) * 1024

	readers := uploadLoadInt(
		"DISCLOUD_LOAD_RANGE_READERS",
		16,
	)
	readsPerReader := uploadLoadInt(
		"DISCLOUD_LOAD_RANGE_READS",
		64,
	)

	if fileSize < chunkSize*2 {
		t.Fatalf(
			"range load file size %d must be at least two chunks of %d",
			fileSize,
			chunkSize,
		)
	}
	if rangeSize <= 0 || rangeSize > chunkSize {
		t.Fatalf(
			"range size %d must be between 1 and chunk size %d",
			rangeSize,
			chunkSize,
		)
	}

	service := New(pool, chunkSize, time.Hour)
	store := fake.New(
		"bot-a",
		"bot-b",
		"bot-c",
		"bot-d",
	)
	uploader := NewPartUploader(service, store)
	finalizer := NewFinalizer(service, store)

	file, err := uploadLoadFile(
		ctx,
		service,
		uploader,
		finalizer,
		Actor{UserID: userID},
		rootID,
		"range-video.bin",
		fileSize,
		chunkSize,
		0,
	)
	if err != nil {
		t.Fatalf("prepare range load file: %v", err)
	}

	fileService := filestore.New(pool, store)
	start := make(chan struct{})
	errors := make(chan error, readers)

	var wait sync.WaitGroup
	wait.Add(readers)

	started := time.Now()

	for worker := range readers {
		worker := worker

		go func() {
			defer wait.Done()

			<-start

			partCount := fileSize / chunkSize
			if fileSize%chunkSize != 0 {
				partCount++
			}

			for read := range readsPerReader {
				sequence := worker*readsPerReader + read
				boundaryIndex :=
					int64(sequence%(int(partCount)-1) + 1)

				boundary := boundaryIndex * chunkSize
				offset := boundary - rangeSize/2

				if offset+rangeSize > fileSize {
					offset = fileSize - rangeSize
				}

				_, reader, err := fileService.Open(
					ctx,
					filestore.Actor{
						UserID: userID,
					},
					file.ID,
					offset,
					rangeSize,
				)
				if err != nil {
					errors <- fmt.Errorf(
						"worker %d read %d open: %w",
						worker,
						read,
						err,
					)
					return
				}

				n, copyErr := io.Copy(
					io.Discard,
					reader,
				)
				closeErr := reader.Close()

				if copyErr != nil {
					errors <- fmt.Errorf(
						"worker %d read %d copy: %w",
						worker,
						read,
						copyErr,
					)
					return
				}
				if closeErr != nil {
					errors <- fmt.Errorf(
						"worker %d read %d close: %w",
						worker,
						read,
						closeErr,
					)
					return
				}
				if n != rangeSize {
					errors <- fmt.Errorf(
						"worker %d read %d bytes=%d want=%d",
						worker,
						read,
						n,
						rangeSize,
					)
					return
				}
			}
		}()
	}

	close(start)
	wait.Wait()
	close(errors)

	for err := range errors {
		t.Error(err)
	}
	if t.Failed() {
		return
	}

	elapsed := time.Since(started)
	requests := readers * readsPerReader
	totalBytes := int64(requests) * rangeSize

	t.Logf(
		"range load readers=%d reads=%d range=%dKiB elapsed=%s requests/s=%.1f throughput=%.1fMiB/s",
		readers,
		requests,
		rangeSize/1024,
		elapsed,
		float64(requests)/elapsed.Seconds(),
		float64(totalBytes)/(1024*1024)/elapsed.Seconds(),
	)
}

func runConcurrentUploadLoad(
	t *testing.T,
	label string,
	fileCount int,
	fileSize int64,
	chunkSize int64,
	concurrency int,
) {
	t.Helper()

	if fileCount < 1 ||
		fileSize < 1 ||
		chunkSize < 1 ||
		concurrency < 1 {
		t.Fatal("invalid upload load configuration")
	}

	if concurrency > fileCount {
		concurrency = fileCount
	}

	ctx, pool := openUploadTestPool(t)
	userID, rootID := createUploadUser(
		t,
		ctx,
		pool,
		fmt.Sprintf(
			"%s-load-owner",
			label,
		),
		nil,
	)

	service := New(
		pool,
		chunkSize,
		time.Hour,
	)
	store := fake.New(
		"bot-a",
		"bot-b",
		"bot-c",
		"bot-d",
	)
	uploader := NewPartUploader(
		service,
		store,
	)
	finalizer := NewFinalizer(
		service,
		store,
	)

	start := make(chan struct{})
	semaphore := make(chan struct{}, concurrency)
	errors := make(chan error, fileCount)

	var wait sync.WaitGroup
	wait.Add(fileCount)

	started := time.Now()

	for index := range fileCount {
		index := index

		go func() {
			defer wait.Done()

			<-start
			semaphore <- struct{}{}
			defer func() {
				<-semaphore
			}()

			_, err := uploadLoadFile(
				ctx,
				service,
				uploader,
				finalizer,
				Actor{UserID: userID},
				rootID,
				fmt.Sprintf(
					"%s-%05d.bin",
					label,
					index,
				),
				fileSize,
				chunkSize,
				index,
			)
			if err != nil {
				errors <- fmt.Errorf(
					"file %d: %w",
					index,
					err,
				)
			}
		}()
	}

	close(start)
	wait.Wait()
	close(errors)

	for err := range errors {
		t.Error(err)
	}
	if t.Failed() {
		return
	}

	elapsed := time.Since(started)

	var activeFiles int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM nodes
		WHERE owner_user_id = $1::uuid
		  AND kind = 'file'
		  AND deleted_at IS NULL
	`, userID).Scan(&activeFiles); err != nil {
		t.Fatalf(
			"count active files: %v",
			err,
		)
	}
	if activeFiles != fileCount {
		t.Fatalf(
			"active files = %d, want %d",
			activeFiles,
			fileCount,
		)
	}

	var used, reserved int64
	if err := pool.QueryRow(ctx, `
		SELECT
			storage_used_bytes,
			storage_reserved_bytes
		FROM users
		WHERE id = $1::uuid
	`, userID).Scan(
		&used,
		&reserved,
	); err != nil {
		t.Fatalf(
			"read load quota: %v",
			err,
		)
	}

	wantUsed :=
		int64(fileCount) * fileSize

	if used != wantUsed || reserved != 0 {
		t.Fatalf(
			"quota used=%d reserved=%d, want %d/0",
			used,
			reserved,
			wantUsed,
		)
	}

	var metadataJobs int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM jobs
		WHERE type = 'file.metadata'
	`, userID).Scan(&metadataJobs); err != nil {
		t.Fatalf(
			"count metadata jobs: %v",
			err,
		)
	}
	if metadataJobs != fileCount {
		t.Fatalf(
			"metadata jobs = %d, want %d",
			metadataJobs,
			fileCount,
		)
	}

	totalBytes := int64(fileCount) * fileSize

	t.Logf(
		"%s upload load files=%d concurrency=%d total=%.1fMiB elapsed=%s files/s=%.2f throughput=%.1fMiB/s",
		label,
		fileCount,
		concurrency,
		float64(totalBytes)/(1024*1024),
		elapsed,
		float64(fileCount)/elapsed.Seconds(),
		float64(totalBytes)/(1024*1024)/elapsed.Seconds(),
	)
}

func uploadLoadFile(
	ctx context.Context,
	service *Service,
	uploader *PartUploader,
	finalizer *Finalizer,
	actor Actor,
	rootID string,
	name string,
	size int64,
	chunkSize int64,
	fileIndex int,
) (CompletedFile, error) {
	session, err := service.Create(
		ctx,
		actor,
		CreateInput{
			ParentFolderID: rootID,
			Name:           name,
			SizeBytes:      size,
		},
	)
	if err != nil {
		return CompletedFile{},
			fmt.Errorf(
				"create session: %w",
				err,
			)
	}

	partIndex := 0

	for offset := int64(0); offset < size; offset += chunkSize {
		partSize := chunkSize
		if remaining := size - offset; remaining < partSize {
			partSize = remaining
		}

		data := make(
			[]byte,
			int(partSize),
		)

		seed := byte(
			(fileIndex*37+
				partIndex*17)%251 +
				1,
		)

		for index := range data {
			data[index] =
				seed ^ byte(index%251)
		}

		digest := sha256.Sum256(data)

		if _, err := uploader.PutPart(
			ctx,
			actor,
			session.ID,
			partIndex,
			digest,
			bytes.NewReader(data),
		); err != nil {
			return CompletedFile{},
				fmt.Errorf(
					"upload part %d: %w",
					partIndex,
					err,
				)
		}

		partIndex++
	}

	file, err := finalizer.Finalize(
		ctx,
		actor,
		session.ID,
	)
	if err != nil {
		return CompletedFile{},
			fmt.Errorf(
				"finalize: %w",
				err,
			)
	}

	return file, nil
}

func requireUploadLoadTest(t *testing.T) {
	t.Helper()

	if os.Getenv(
		"DISCLOUD_RUN_LOAD_TESTS",
	) != "1" {
		t.Skip(
			"set DISCLOUD_RUN_LOAD_TESTS=1 to run load tests",
		)
	}
}

func uploadLoadInt(
	name string,
	fallback int,
) int {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return fallback
	}

	return value
}
