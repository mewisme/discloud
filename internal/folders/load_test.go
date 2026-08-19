package folders

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"strconv"
	"testing"
	"time"
)

func TestLoadFolderZIPStreaming(t *testing.T) {
	if os.Getenv(
		"DISCLOUD_RUN_LOAD_TESTS",
	) != "1" {
		t.Skip(
			"set DISCLOUD_RUN_LOAD_TESTS=1 to run load tests",
		)
	}

	fileCount := folderLoadInt(
		"DISCLOUD_LOAD_ZIP_FILES",
		5000,
	)
	fileSize := folderLoadInt(
		"DISCLOUD_LOAD_ZIP_FILE_KIB",
		4,
	) * 1024
	filesPerFolder := folderLoadInt(
		"DISCLOUD_LOAD_ZIP_FILES_PER_FOLDER",
		50,
	)

	payload := bytes.Repeat(
		[]byte{0x5a},
		fileSize,
	)

	folderCount :=
		(fileCount + filesPerFolder - 1) /
			filesPerFolder

	archive := Archive{
		Filename: "load.zip",
		Entries: make(
			[]ArchiveEntry,
			0,
			fileCount+folderCount,
		),
	}

	for folder := range folderCount {
		archive.Entries = append(
			archive.Entries,
			ArchiveEntry{
				NodeID: fmt.Sprintf(
					"folder-%d",
					folder,
				),
				Path: fmt.Sprintf(
					"folder-%04d",
					folder,
				),
				Kind: "folder",
			},
		)
	}

	for index := range fileCount {
		folder :=
			index /
				filesPerFolder

		archive.Entries = append(
			archive.Entries,
			ArchiveEntry{
				NodeID: fmt.Sprintf(
					"file-%d",
					index,
				),
				Path: fmt.Sprintf(
					"folder-%04d/file-%06d.bin",
					folder,
					index,
				),
				Kind:      "file",
				SizeBytes: int64(fileSize),
			},
		)
	}

	writer := &folderLoadWriter{}
	service := &Service{}

	started := time.Now()

	err := service.writeZIP(
		context.Background(),
		archive,
		writer,
		func(
			_ string,
			size int64,
		) (io.ReadCloser, error) {
			if size != int64(fileSize) {
				return nil,
					fmt.Errorf(
						"unexpected file size %d",
						size,
					)
			}

			return io.NopCloser(
				bytes.NewReader(payload),
			), nil
		},
	)
	if err != nil {
		t.Fatalf(
			"write ZIP: %v",
			err,
		)
	}

	elapsed := time.Since(started)
	payloadBytes :=
		int64(fileCount) *
			int64(fileSize)

	if writer.bytes < payloadBytes {
		t.Fatalf(
			"ZIP bytes=%d, smaller than payload=%d",
			writer.bytes,
			payloadBytes,
		)
	}

	t.Logf(
		"ZIP files=%d folders=%d payload=%.1fMiB output=%.1fMiB elapsed=%s throughput=%.1fMiB/s",
		fileCount,
		folderCount,
		float64(payloadBytes)/(1024*1024),
		float64(writer.bytes)/(1024*1024),
		elapsed,
		float64(payloadBytes)/(1024*1024)/elapsed.Seconds(),
	)
}

type folderLoadWriter struct {
	bytes int64
}

func (w *folderLoadWriter) Write(
	value []byte,
) (int, error) {
	w.bytes += int64(len(value))
	return len(value), nil
}

func folderLoadInt(
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
