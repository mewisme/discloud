package media

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	"io"
	"os"
	"os/exec"
	"strings"
)

func ProcessVideoThumbnail(ctx context.Context, src io.Reader) (ProcessedImage, error) {
	if src == nil {
		return ProcessedImage{}, errors.New("video source is unavailable")
	}

	input, err := os.CreateTemp("", "discloud-thumbnail-video-*")
	if err != nil {
		return ProcessedImage{}, fmt.Errorf("create video thumbnail input: %w", err)
	}
	inputPath := input.Name()
	defer os.Remove(inputPath)

	size, copyErr := io.Copy(input, src)
	closeErr := input.Close()
	if copyErr != nil {
		return ProcessedImage{}, fmt.Errorf("spool video thumbnail input: %w", copyErr)
	}
	if closeErr != nil {
		return ProcessedImage{}, fmt.Errorf("close video thumbnail input: %w", closeErr)
	}
	if size == 0 {
		return ProcessedImage{}, errors.New("video is empty")
	}

	output, err := os.CreateTemp("", "discloud-thumbnail-*.jpg")
	if err != nil {
		return ProcessedImage{}, fmt.Errorf("create video thumbnail output: %w", err)
	}
	outputPath := output.Name()
	if err := output.Close(); err != nil {
		os.Remove(outputPath)
		return ProcessedImage{}, fmt.Errorf("close video thumbnail output: %w", err)
	}
	defer os.Remove(outputPath)

	command := exec.CommandContext(
		ctx,
		"ffmpeg",
		"-hide_banner",
		"-loglevel", "error",
		"-i", inputPath,
		"-vf", "thumbnail=30,scale=512:512:force_original_aspect_ratio=decrease",
		"-frames:v", "1",
		"-q:v", "3",
		"-y",
		outputPath,
	)
	stderr, err := command.CombinedOutput()
	if err != nil {
		detail := strings.TrimSpace(string(stderr))
		if detail == "" {
			detail = err.Error()
		}
		return ProcessedImage{}, fmt.Errorf("generate video thumbnail: %s", truncate(detail, 1000))
	}

	data, err := os.ReadFile(outputPath)
	if err != nil {
		return ProcessedImage{}, fmt.Errorf("read video thumbnail: %w", err)
	}
	if len(data) == 0 {
		return ProcessedImage{}, errors.New("ffmpeg produced an empty thumbnail")
	}

	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return ProcessedImage{}, errors.New("ffmpeg produced an invalid thumbnail")
	}
	return ProcessedImage{Data: data, MIMEType: "image/jpeg", Filename: "thumbnail.jpg", Width: config.Width, Height: config.Height}, nil
}

func truncate(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}
