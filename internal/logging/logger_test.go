package logging

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/mewisme/discloud/internal/config"
)

func TestNewFiltersByLevel(t *testing.T) {
	var out bytes.Buffer

	logger, err := New(&out, config.LogConfig{Level: config.LogLevelInfo})
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	logger.Debug("hidden")
	logger.Info("visible", slog.String("component", "test"))

	if bytes.Contains(out.Bytes(), []byte("hidden")) {
		t.Fatal("debug log should be filtered")
	}

	var entry map[string]any
	if err := json.Unmarshal(out.Bytes(), &entry); err != nil {
		t.Fatalf("decode log: %v", err)
	}
	if entry["level"] != "INFO" {
		t.Fatalf("level = %v, want INFO", entry["level"])
	}
	if entry["msg"] != "visible" {
		t.Fatalf("msg = %v, want visible", entry["msg"])
	}
	if entry["component"] != "test" {
		t.Fatalf("component = %v, want test", entry["component"])
	}
}

func TestNewDebugLevel(t *testing.T) {
	var out bytes.Buffer

	logger, err := New(&out, config.LogConfig{Level: config.LogLevelDebug})
	if err != nil {
		t.Fatalf("New() error: %v", err)
	}

	logger.Debug("visible")

	if !bytes.Contains(out.Bytes(), []byte(`"msg":"visible"`)) {
		t.Fatalf("debug log missing: %s", out.String())
	}
}

func TestNewRejectsInvalidLevel(t *testing.T) {
	_, err := New(&bytes.Buffer{}, config.LogConfig{Level: "trace"})
	if err == nil {
		t.Fatal("New() expected error")
	}
}
