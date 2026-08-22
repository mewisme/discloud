package folders

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"testing"

	"github.com/mewisme/discloud/internal/files"
)

type fakeFileOpener map[string][]byte

func (f fakeFileOpener) Open(_ context.Context, _ files.Actor, id string, _, _ int64) (files.File, io.ReadCloser, error) {
	data, ok := f[id]
	if !ok {
		return files.File{}, nil, errors.New("file not found")
	}
	return files.File{ID: id, SizeBytes: int64(len(data))}, io.NopCloser(bytes.NewReader(data)), nil
}

func TestBuildArchiveSanitizesAndDeduplicates(t *testing.T) {
	one, two := int64(1), int64(1)
	archive, err := buildArchive([]treeNode{
		{ID: "root", Kind: "folder", Name: "Docs"},
		{ID: "a", ParentID: "root", Kind: "file", Name: "a\\b.txt", SizeBytes: &one},
		{ID: "b", ParentID: "root", Kind: "file", Name: "a_b.txt", SizeBytes: &two},
	})
	if err != nil {
		t.Fatalf("buildArchive(): %v", err)
	}

	want := []string{"Docs", "Docs/a_b.txt", "Docs/a_b (2).txt"}
	if len(archive.Entries) != len(want) {
		t.Fatalf("entries = %d, want %d", len(archive.Entries), len(want))
	}
	if archive.NodeCount != 3 {
		t.Fatalf("node count = %d, want 3", archive.NodeCount)
	}
	for i, path := range want {
		if archive.Entries[i].Path != path {
			t.Fatalf("entry %d = %q, want %q", i, archive.Entries[i].Path, path)
		}
	}
}

func TestValidatePreparedArchiveLimits(t *testing.T) {
	archive := Archive{
		Filename:  "Docs.zip",
		NodeCount: 3,
		Entries: []ArchiveEntry{
			{NodeID: "root", Path: "Docs", Kind: "folder"},
			{NodeID: "a", Path: "Docs/a.bin", Kind: "file", SizeBytes: 40},
			{NodeID: "b", Path: "Docs/b.bin", Kind: "file", SizeBytes: 60},
		},
	}

	if err := validatePreparedArchiveLimits(archive, ArchiveLimits{
		MaxEntries: 3,
		MaxBytes:   100,
	}); err != nil {
		t.Fatalf("exact archive limits: %v", err)
	}

	if err := validatePreparedArchiveLimits(archive, ArchiveLimits{
		MaxEntries: 2,
		MaxBytes:   100,
	}); !errors.Is(err, ErrArchiveTooLarge) {
		t.Fatalf("entry limit error = %v, want ErrArchiveTooLarge", err)
	}

	if err := validatePreparedArchiveLimits(archive, ArchiveLimits{
		MaxEntries: 3,
		MaxBytes:   99,
	}); !errors.Is(err, ErrArchiveTooLarge) {
		t.Fatalf("byte limit error = %v, want ErrArchiveTooLarge", err)
	}
}

func TestWriteZIP(t *testing.T) {
	service := &Service{files: fakeFileOpener{
		"a": []byte("hello"),
		"b": []byte("world"),
	}}

	archive := Archive{
		Filename: "Docs.zip",
		Entries: []ArchiveEntry{
			{NodeID: "root", Path: "Docs", Kind: "folder"},
			{NodeID: "sub", Path: "Docs/Sub", Kind: "folder"},
			{NodeID: "a", Path: "Docs/a.txt", Kind: "file", SizeBytes: 5},
			{NodeID: "b", Path: "Docs/Sub/b.txt", Kind: "file", SizeBytes: 5},
		},
	}

	var buf bytes.Buffer
	if err := service.WriteZIP(context.Background(), Actor{}, archive, &buf); err != nil {
		t.Fatalf("WriteZIP(): %v", err)
	}

	reader, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("open ZIP: %v", err)
	}

	want := map[string]string{
		"Docs/":          "",
		"Docs/Sub/":      "",
		"Docs/a.txt":     "hello",
		"Docs/Sub/b.txt": "world",
	}
	if len(reader.File) != len(want) {
		t.Fatalf("ZIP entries = %d, want %d", len(reader.File), len(want))
	}

	for _, file := range reader.File {
		source, err := file.Open()
		if err != nil {
			t.Fatalf("open %s: %v", file.Name, err)
		}
		data, err := io.ReadAll(source)
		source.Close()
		if err != nil {
			t.Fatalf("read %s: %v", file.Name, err)
		}
		if string(data) != want[file.Name] {
			t.Fatalf("%s = %q, want %q", file.Name, data, want[file.Name])
		}
	}
}

func TestSanitizeArchiveSegmentRejectsTraversal(t *testing.T) {
	for _, name := range []string{"", ".", "..", "a\x00b"} {
		if _, err := sanitizeArchiveSegment(name); !errors.Is(err, ErrInvalidArchivePath) {
			t.Fatalf("sanitizeArchiveSegment(%q) = %v", name, err)
		}
	}
}
