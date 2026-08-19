package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

func TestAuthHTTPFlowIntegration(t *testing.T) {
	dsn := os.Getenv("DISCLOUD_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("DISCLOUD_TEST_DATABASE_DSN is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open admin pool: %v", err)
	}
	defer admin.Close()

	schema := fmt.Sprintf("discloud_http_auth_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()

	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	defer admin.Exec(context.Background(), "DROP SCHEMA "+identifier+" CASCADE")

	poolCfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse DSN: %v", err)
	}
	poolCfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		t.Fatalf("open isolated pool: %v", err)
	}
	defer pool.Close()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := migrate.Up(ctx, pool, migrations.FS, logger); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	passwordHash, err := auth.HashPassword("correct-horse-battery-staple")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO users (username, password_hash)
		VALUES ('alice', $1)
	`, passwordHash); err != nil {
		t.Fatalf("create user: %v", err)
	}

	authConfig := config.AuthConfig{
		SessionTTL: time.Hour,
		Cookie: config.CookieConfig{
			Name:     "discloud_session",
			Path:     "/",
			Secure:   false,
			SameSite: config.SameSiteLax,
		},
	}

	authService := auth.New(pool, authConfig.SessionTTL)
	router := NewRouter(
		RouterDependencies{
			Ready: pool.Ping,
			Auth:  authService,
		},
		config.HTTPConfig{},
		authConfig,
	)

	loginReq := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/login",
		strings.NewReader(`{"username":"Alice","password":"correct-horse-battery-staple"}`),
	)
	loginReq.Header.Set("Content-Type", "application/json")

	loginRec := httptest.NewRecorder()
	router.ServeHTTP(loginRec, loginReq)

	if loginRec.Code != http.StatusOK {
		t.Fatalf("login status = %d, body = %s", loginRec.Code, loginRec.Body.String())
	}

	var sessionCookie *http.Cookie
	for _, cookie := range loginRec.Result().Cookies() {
		if cookie.Name == authConfig.Cookie.Name {
			sessionCookie = cookie
			break
		}
	}

	if sessionCookie == nil {
		t.Fatal("session cookie was not set")
	}

	meReq := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	meReq.AddCookie(sessionCookie)

	meRec := httptest.NewRecorder()
	router.ServeHTTP(meRec, meReq)

	if meRec.Code != http.StatusOK {
		t.Fatalf("me status = %d, body = %s", meRec.Code, meRec.Body.String())
	}

	mfaReq := httptest.NewRequest(http.MethodGet, "/api/v1/me/mfa", nil)
	mfaReq.AddCookie(sessionCookie)

	mfaRec := httptest.NewRecorder()
	router.ServeHTTP(mfaRec, mfaReq)

	if mfaRec.Code != http.StatusOK {
		t.Fatalf("MFA status = %d, body = %s", mfaRec.Code, mfaRec.Body.String())
	}

	var mfaStatus mfaStatusResponse
	if err := json.NewDecoder(mfaRec.Body).Decode(&mfaStatus); err != nil {
		t.Fatalf("decode MFA status: %v", err)
	}
	if mfaStatus.Enabled {
		t.Fatal("new user unexpectedly has MFA enabled")
	}

	logoutReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	logoutReq.AddCookie(sessionCookie)

	logoutRec := httptest.NewRecorder()
	router.ServeHTTP(logoutRec, logoutReq)

	if logoutRec.Code != http.StatusNoContent {
		t.Fatalf("logout status = %d, body = %s", logoutRec.Code, logoutRec.Body.String())
	}

	afterReq := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	afterReq.AddCookie(sessionCookie)

	afterRec := httptest.NewRecorder()
	router.ServeHTTP(afterRec, afterReq)

	if afterRec.Code != http.StatusUnauthorized {
		t.Fatalf("after logout status = %d, want %d", afterRec.Code, http.StatusUnauthorized)
	}
}
