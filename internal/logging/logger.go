package logging

import (
	"fmt"
	"io"
	"log/slog"

	"github.com/mewisme/discloud/internal/config"
)

func New(out io.Writer, cfg config.LogConfig) (*slog.Logger, error) {
	level, err := parseLevel(cfg.Level)
	if err != nil {
		return nil, err
	}

	return slog.New(slog.NewJSONHandler(out, &slog.HandlerOptions{Level: level})), nil
}

func parseLevel(level config.LogLevel) (slog.Level, error) {
	switch level {
	case config.LogLevelDebug:
		return slog.LevelDebug, nil
	case config.LogLevelInfo:
		return slog.LevelInfo, nil
	case config.LogLevelWarn:
		return slog.LevelWarn, nil
	case config.LogLevelError:
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("unsupported log level %q", level)
	}
}
