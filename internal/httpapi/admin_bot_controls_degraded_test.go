package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mewisme/discloud/internal/discordstore"
)

func TestConfiguredBotRuntimeControlHandler(t *testing.T) {
	var got int
	handler := configuredBotRuntimeControlHandler(func(_ context.Context, configIndex int) error {
		got = configIndex
		return nil
	})

	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/bots/config/3/probe", nil)
	request.SetPathValue("configIndex", "3")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", recorder.Code)
	}
	if got != 3 {
		t.Fatalf("config index = %d, want 3", got)
	}
}

func TestConfiguredBotRuntimeControlHandlerRejectsInvalidIndex(t *testing.T) {
	handler := configuredBotRuntimeControlHandler(func(context.Context, int) error {
		t.Fatal("action should not run")
		return nil
	})

	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/bots/config/nope/probe", nil)
	request.SetPathValue("configIndex", "nope")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
}

func TestWriteBotRuntimeControlErrorMapsDuplicateConfiguredBot(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/bots/config/1/probe", nil)
	recorder := httptest.NewRecorder()
	writeBotRuntimeControlError(recorder, request, errors.Join(discordstore.ErrDuplicateBotUser, errors.New("duplicate")))

	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", recorder.Code)
	}
}
