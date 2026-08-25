package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestManagedShutdownContextCancelsWhenFileAppears(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shutdown")
	t.Setenv(managedShutdownFileEnv, path)
	ctx, cancel := managedShutdownContext(context.Background())
	defer cancel()
	if err := os.WriteFile(path, []byte("shutdown\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ctx.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("managed shutdown context was not canceled")
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("managed shutdown file was not acknowledged: %v", err)
	}
}
