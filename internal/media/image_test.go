package media

import (
	"bytes"
	"errors"
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

func TestProcessClientThumbnail(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 512, 256))
	var input bytes.Buffer
	if err := png.Encode(&input, source); err != nil {
		t.Fatalf("encode source: %v", err)
	}

	processed, err := ProcessClientThumbnail(bytes.NewReader(input.Bytes()))
	if err != nil {
		t.Fatalf("ProcessClientThumbnail(): %v", err)
	}
	if processed.MIMEType != "image/png" || processed.Filename != "thumbnail.png" {
		t.Fatalf("canonical output = %s %s", processed.MIMEType, processed.Filename)
	}

	config, _, err := image.DecodeConfig(bytes.NewReader(processed.Data))
	if err != nil {
		t.Fatalf("decode thumbnail: %v", err)
	}
	if config.Width != 512 || config.Height != 256 {
		t.Fatalf("thumbnail size = %dx%d, want 512x256", config.Width, config.Height)
	}

	if _, err := ProcessClientThumbnail(bytes.NewReader([]byte("not an image"))); !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("invalid image = %v, want ErrInvalidImage", err)
	}

	oversized := make([]byte, ClientThumbnailMaxBytes+1)
	if _, err := ProcessClientThumbnail(bytes.NewReader(oversized)); !errors.Is(err, ErrImageTooLarge) {
		t.Fatalf("oversized image = %v, want ErrImageTooLarge", err)
	}

	var oversizedDimensions bytes.Buffer
	if err := png.Encode(&oversizedDimensions, image.NewNRGBA(image.Rect(0, 0, ThumbnailMaxDimension+1, ThumbnailMaxDimension-1))); err != nil {
		t.Fatalf("encode oversized dimensions: %v", err)
	}
	if _, err := ProcessClientThumbnail(bytes.NewReader(oversizedDimensions.Bytes())); !errors.Is(err, ErrImageTooLarge) {
		t.Fatalf("oversized dimensions = %v, want ErrImageTooLarge", err)
	}
}
