package files

import (
	"bytes"
	"image"
	"image/png"
	"testing"
)

func TestCanonicalMIMEPrefersContent(t *testing.T) {
	got := canonicalMIME(
		[]byte("%PDF-1.7\n"),
		"txt",
		"text/plain",
	)

	if got != "application/pdf" {
		t.Fatalf("MIME = %q, want application/pdf", got)
	}
}

func TestCanonicalMIMEFallsBackToExtension(t *testing.T) {
	got := canonicalMIME(
		[]byte{0, 1, 2, 3, 4},
		"pdf",
		"text/plain",
	)

	if got != "application/pdf" {
		t.Fatalf("MIME = %q, want application/pdf", got)
	}
}

func TestCanonicalMIMEFallsBackToHint(t *testing.T) {
	got := canonicalMIME(
		[]byte{0, 1, 2, 3, 4},
		"",
		"Video/MP4; codecs=avc1",
	)

	if got != "video/mp4" {
		t.Fatalf("MIME = %q, want video/mp4", got)
	}
}

func TestFileExtension(t *testing.T) {
	tests := map[string]string{
		"photo.JPG":      "jpg",
		"archive.tar.gz": "gz",
		"README":         "",
		".gitignore":     "",
	}

	for name, want := range tests {
		if got := fileExtension(name); got != want {
			t.Fatalf("fileExtension(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestCategoryForMIME(t *testing.T) {
	tests := map[string]string{
		"image/png":                "image",
		"video/mp4":                "video",
		"audio/mpeg":               "audio",
		"text/plain":               "text",
		"application/pdf":          "document",
		"application/zip":          "archive",
		"application/json":         "application",
		"application/octet-stream": "binary",
	}

	for mimeType, want := range tests {
		if got := categoryForMIME(mimeType); got != want {
			t.Fatalf("categoryForMIME(%q) = %q, want %q", mimeType, got, want)
		}
	}
}

func TestImageDecodeConfigProbeShape(t *testing.T) {
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 320, 180))); err != nil {
		t.Fatalf("encode PNG: %v", err)
	}

	config, format, err := image.DecodeConfig(bytes.NewReader(data.Bytes()))
	if err != nil {
		t.Fatalf("DecodeConfig(): %v", err)
	}
	if format != "png" || config.Width != 320 || config.Height != 180 {
		t.Fatalf("image = %s %dx%d", format, config.Width, config.Height)
	}
}
