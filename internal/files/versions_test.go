package files

import "testing"

func TestVersionFileProjection(t *testing.T) {
	version := Version{FileID: "file-id", Name: "report.pdf", SizeBytes: 42, ChunkSizeBytes: 16, MIMEType: "application/pdf", Category: "document"}
	file := version.File()
	if file.ID != version.FileID || file.Name != version.Name || file.SizeBytes != version.SizeBytes || file.ChunkSizeBytes != version.ChunkSizeBytes {
		t.Fatalf("version projection mismatch: %#v", file)
	}
}
