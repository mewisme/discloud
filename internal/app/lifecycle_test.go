package app

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestRunServerStopsOnContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	server := &http.Server{Addr: "127.0.0.1:0", Handler: http.NewServeMux()}

	done := make(chan error, 1)
	go func() { done <- runServer(ctx, server, time.Second) }()

	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("runServer() error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("runServer() did not stop")
	}
}
