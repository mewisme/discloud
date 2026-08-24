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
	"time"
)

const (
	videoThumbnailOutputMaxBytes int64 = 8 * 1024 * 1024
	videoThumbnailStderrMaxBytes       = 64 * 1024
	videoThumbnailWaitDelay            = 2 * time.Second
)

func ProcessVideoThumbnail(ctx context.Context, sourceURL string) (ProcessedImage, error) {
	return ProcessMediaThumbnail(ctx, sourceURL, "video")
}

func ProcessMediaThumbnail(ctx context.Context, sourceURL, category string) (ProcessedImage, error) {
	if strings.TrimSpace(sourceURL) == "" {
		return ProcessedImage{}, errors.New("video source is unavailable")
	}

	output, err := os.CreateTemp("", "discloud-thumbnail-*.jpg")
	if err != nil {
		return ProcessedImage{}, fmt.Errorf("create video thumbnail output: %w", err)
	}
	outputPath := output.Name()
	if err := output.Close(); err != nil {
		_ = os.Remove(outputPath)
		return ProcessedImage{}, fmt.Errorf("close video thumbnail output: %w", err)
	}
	defer os.Remove(outputPath)

	filter := "thumbnail=30,scale=512:512:force_original_aspect_ratio=decrease"
	if category == "audio" {
		filter = "scale=512:512:force_original_aspect_ratio=decrease"
	}

	stderr := &cappedBuffer{limit: videoThumbnailStderrMaxBytes}
	command := exec.CommandContext(
		ctx,
		"ffmpeg",
		"-nostdin",
		"-hide_banner",
		"-loglevel", "error",
		"-protocol_whitelist", "http,tcp",
		"-rw_timeout", "15000000",
		"-probesize", "8388608",
		"-analyzeduration", "5000000",
		"-filter_threads", "1",
		"-threads", "1",
		"-i", sourceURL,
		"-map", "0:v:0",
		"-an",
		"-sn",
		"-dn",
		"-vf", filter,
		"-frames:v", "1",
		"-q:v", "3",
		"-y",
		outputPath,
	)
	command.Stdout = io.Discard
	command.Stderr = stderr
	command.WaitDelay = videoThumbnailWaitDelay

	if err := command.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ProcessedImage{}, fmt.Errorf("generate video thumbnail: %w", ctxErr)
		}

		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}
		return ProcessedImage{}, fmt.Errorf("generate video thumbnail: %s", truncate(detail, 1000))
	}

	info, err := os.Stat(outputPath)
	if err != nil {
		return ProcessedImage{}, fmt.Errorf("stat video thumbnail: %w", err)
	}
	if info.Size() == 0 {
		return ProcessedImage{}, errors.New("ffmpeg produced an empty thumbnail")
	}
	if info.Size() > videoThumbnailOutputMaxBytes {
		return ProcessedImage{}, errors.New("ffmpeg thumbnail exceeds output limit")
	}

	data, err := os.ReadFile(outputPath)
	if err != nil {
		return ProcessedImage{}, fmt.Errorf("read video thumbnail: %w", err)
	}

	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return ProcessedImage{}, errors.New("ffmpeg produced an invalid thumbnail")
	}
	return ProcessedImage{
		Data:     data,
		MIMEType: "image/jpeg",
		Filename: "thumbnail.jpg",
		Width:    config.Width,
		Height:   config.Height,
	}, nil
}

type cappedBuffer struct {
	buffer bytes.Buffer
	limit  int
}

func (b *cappedBuffer) Write(value []byte) (int, error) {
	length := len(value)
	remaining := b.limit - b.buffer.Len()
	if remaining <= 0 {
		return length, nil
	}
	if len(value) > remaining {
		value = value[:remaining]
	}
	_, _ = b.buffer.Write(value)
	return length, nil
}

func (b *cappedBuffer) String() string {
	return b.buffer.String()
}

func truncate(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}
