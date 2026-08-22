package media

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	AvatarMaxBytes         int64 = 10 * 1024 * 1024
	AvatarSize                   = 512
	ThumbnailImageMaxBytes int64 = 64 * 1024 * 1024
	ClientThumbnailMaxBytes int64 = 8 * 1024 * 1024
	ThumbnailMaxDimension        = 512
	MaxDecodedImagePixels  int64 = 64 * 1024 * 1024
)

var (
	ErrEmptyImage    = errors.New("image is empty")
	ErrImageTooLarge = errors.New("image exceeds processing limit")
	ErrInvalidImage  = errors.New("invalid image")
)

type ProcessedImage struct {
	Data     []byte
	MIMEType string
	Filename string
	Width    int
	Height   int
}

func ProcessAvatar(src io.Reader) (ProcessedImage, error) {
	decoded, _, err := decodeBounded(src, AvatarMaxBytes, MaxDecodedImagePixels)
	if err != nil {
		return ProcessedImage{}, err
	}

	output := squareResize(decoded, AvatarSize)
	data, err := encodePNG(output)
	if err != nil {
		return ProcessedImage{}, err
	}
	return ProcessedImage{Data: data, MIMEType: "image/png", Filename: "avatar.png", Width: AvatarSize, Height: AvatarSize}, nil
}

func ProcessImageThumbnail(src io.Reader) (ProcessedImage, error) {
	return processThumbnail(src, ThumbnailImageMaxBytes)
}

// ProcessClientThumbnail validates a browser-generated thumbnail at the trust
// boundary: bounded encoded size, pixel-bomb guard, re-encoded canonical PNG.
func ProcessClientThumbnail(src io.Reader) (ProcessedImage, error) {
	return processThumbnail(src, ClientThumbnailMaxBytes)
}

func processThumbnail(src io.Reader, maxBytes int64) (ProcessedImage, error) {
	decoded, _, err := decodeBounded(src, maxBytes, MaxDecodedImagePixels)
	if err != nil {
		return ProcessedImage{}, err
	}

	output := fitResize(decoded, ThumbnailMaxDimension)
	data, err := encodePNG(output)
	if err != nil {
		return ProcessedImage{}, err
	}
	bounds := output.Bounds()
	return ProcessedImage{Data: data, MIMEType: "image/png", Filename: "thumbnail.png", Width: bounds.Dx(), Height: bounds.Dy()}, nil
}

func decodeBounded(src io.Reader, maxBytes, maxPixels int64) (image.Image, string, error) {
	if src == nil {
		return nil, "", ErrInvalidImage
	}

	data, err := io.ReadAll(io.LimitReader(src, maxBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("read image: %w", err)
	}
	if len(data) == 0 {
		return nil, "", ErrEmptyImage
	}
	if int64(len(data)) > maxBytes {
		return nil, "", ErrImageTooLarge
	}

	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return nil, "", ErrInvalidImage
	}
	if int64(config.Width) > maxPixels/int64(config.Height) {
		return nil, "", ErrImageTooLarge
	}

	decoded, decodedFormat, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", ErrInvalidImage
	}
	if decodedFormat != "" {
		format = decodedFormat
	}
	return decoded, format, nil
}

func squareResize(src image.Image, size int) image.Image {
	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	side := width
	if height < side {
		side = height
	}

	x := bounds.Min.X + (width-side)/2
	y := bounds.Min.Y + (height-side)/2
	srcRect := image.Rect(x, y, x+side, y+side)
	dst := image.NewNRGBA(image.Rect(0, 0, size, size))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, srcRect, xdraw.Over, nil)
	return dst
}

func fitResize(src image.Image, maxDimension int) image.Image {
	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= maxDimension && height <= maxDimension {
		return src
	}

	targetWidth, targetHeight := width, height
	if width >= height {
		targetWidth = maxDimension
		targetHeight = max(1, height*maxDimension/width)
	} else {
		targetHeight = maxDimension
		targetWidth = max(1, width*maxDimension/height)
	}

	dst := image.NewNRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, bounds, xdraw.Over, nil)
	return dst
}

func encodePNG(src image.Image) ([]byte, error) {
	var output bytes.Buffer
	if err := png.Encode(&output, src); err != nil {
		return nil, fmt.Errorf("encode PNG: %w", err)
	}
	return output.Bytes(), nil
}
