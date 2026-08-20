package media

import (
	"bytes"
	"image"
	"image/png"
	"testing"
)

func TestProcessAvatar(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 800, 400))
	var input bytes.Buffer
	if err := png.Encode(&input, source); err != nil {
		t.Fatalf("encode source: %v", err)
	}

	processed, err := ProcessAvatar(bytes.NewReader(input.Bytes()))
	if err != nil {
		t.Fatalf("ProcessAvatar(): %v", err)
	}
	if processed.Width != AvatarSize || processed.Height != AvatarSize {
		t.Fatalf("avatar size = %dx%d, want %dx%d", processed.Width, processed.Height, AvatarSize, AvatarSize)
	}

	config, _, err := image.DecodeConfig(bytes.NewReader(processed.Data))
	if err != nil {
		t.Fatalf("decode avatar: %v", err)
	}
	if config.Width != AvatarSize || config.Height != AvatarSize {
		t.Fatalf("encoded avatar size = %dx%d", config.Width, config.Height)
	}
}

func TestProcessImageThumbnail(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 1024, 512))
	var input bytes.Buffer
	if err := png.Encode(&input, source); err != nil {
		t.Fatalf("encode source: %v", err)
	}

	processed, err := ProcessImageThumbnail(bytes.NewReader(input.Bytes()))
	if err != nil {
		t.Fatalf("ProcessImageThumbnail(): %v", err)
	}
	if processed.Width != ThumbnailMaxDimension || processed.Height != ThumbnailMaxDimension/2 {
		t.Fatalf("thumbnail size = %dx%d, want %dx%d", processed.Width, processed.Height, ThumbnailMaxDimension, ThumbnailMaxDimension/2)
	}
}
