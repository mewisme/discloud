package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
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

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/blobstore/fake"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/files"
	"github.com/mewisme/discloud/internal/media"
	"github.com/mewisme/discloud/internal/nodes"
	"github.com/mewisme/discloud/internal/objects"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/internal/thumbnails"
	"github.com/mewisme/discloud/migrations"
)

func TestFileThumbnailUploadIntegration(t *testing.T) {
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

	schema := fmt.Sprintf("discloud_http_thumbnail_test_%d", time.Now().UnixNano())
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

	var ownerID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash)
		VALUES ('alice', $1)
		RETURNING id::text
	`, passwordHash).Scan(&ownerID); err != nil {
		t.Fatalf("create owner: %v", err)
	}

	var guestID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash)
		VALUES ('guest', $1)
		RETURNING id::text
	`, passwordHash).Scan(&guestID); err != nil {
		t.Fatalf("create guest: %v", err)
	}

	rootID := createThumbnailFolder(t, ctx, pool, ownerID, "", "root")
	folderID := createThumbnailFolder(t, ctx, pool, ownerID, rootID, "photos")
	fileID := createThumbnailFile(t, ctx, pool, ownerID, folderID, "cat.png", 16)

	authConfig := config.AuthConfig{
		SessionTTL: time.Hour,
		Cookie: config.CookieConfig{
			Name:     "discloud_session",
			Path:     "/",
			Secure:   false,
			SameSite: config.SameSiteLax,
		},
	}

	objectStore := &stubDirectObjectStore{}
	filesService := files.New(pool, fake.New("bot-1"))
	objectService := objects.New(pool, objectStore, 0)
	router := NewRouter(
		RouterDependencies{
			Ready:      pool.Ping,
			Auth:       auth.New(pool, authConfig.SessionTTL),
			ACL:        acl.New(pool),
			Files:      filesService,
			Thumbnails: thumbnails.New(pool, filesService, objectService),
		},
		config.HTTPConfig{},
		authConfig,
	)

	ownerCookies := loginForThumbnailTest(t, router, authConfig)
	guestCookies := loginForThumbnailTestGuest(t, router, authConfig)

	unauthorized := httptest.NewRequest(http.MethodPut, "/api/v1/files/"+fileID+"/thumbnail", bytes.NewReader(validThumbnailPNG(t)))
	unauthorizedRec := httptest.NewRecorder()
	router.ServeHTTP(unauthorizedRec, unauthorized)
	if unauthorizedRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", unauthorizedRec.Code)
	}

	invalid := thumbnailRequest(t, router, guestCookies, fileID, bytes.NewReader([]byte("not an image")))
	if invalid.Code != http.StatusNotFound {
		t.Fatalf("unrelated user upload status = %d, want 404", invalid.Code)
	}

	aclService := acl.New(pool)
	_, err = aclService.Set(ctx, acl.Actor{UserID: ownerID}, folderID, guestID, acl.View)
	if err != nil {
		t.Fatalf("grant viewer: %v", err)
	}

	viewer := thumbnailRequest(t, router, guestCookies, fileID, bytes.NewReader([]byte("not an image")))
	if viewer.Code != http.StatusForbidden {
		t.Fatalf("granted viewer upload status = %d, want 403", viewer.Code)
	}

	invalidBody := thumbnailRequest(t, router, ownerCookies, fileID, bytes.NewReader([]byte("not an image")))
	if invalidBody.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("invalid image status = %d, body = %s", invalidBody.Code, invalidBody.Body.String())
	}

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM storage_objects`).Scan(&count); err != nil {
		t.Fatalf("count objects: %v", err)
	}
	if count != 0 {
		t.Fatalf("invalid image stored %d objects, want 0", count)
	}

	oversized := make([]byte, media.ClientThumbnailMaxBytes+1)
	tooLarge := httptest.NewRequest(http.MethodPut, "/api/v1/files/"+fileID+"/thumbnail", bytes.NewReader(oversized))
	tooLarge.Header.Set("Cookie", cookieHeader(ownerCookies))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, tooLarge)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized status = %d, want 413", recorder.Code)
	}

	uploaded := thumbnailRequest(t, router, ownerCookies, fileID, bytes.NewReader(validThumbnailPNG(t)))
	if uploaded.Code != http.StatusOK {
		t.Fatalf("upload status = %d, body = %s", uploaded.Code, uploaded.Body.String())
	}

	var response struct {
		ThumbnailStatus string `json:"thumbnailStatus"`
		Width           int    `json:"width"`
		Height          int    `json:"height"`
	}
	if err := json.Unmarshal(uploaded.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.ThumbnailStatus != "ready" || response.Width <= 0 || response.Height <= 0 {
		t.Fatalf("response = %+v", response)
	}

	var status string
	var objectID *string
	if err := pool.QueryRow(ctx, `
		SELECT status, object_id::text
		FROM file_thumbnails
		WHERE file_id = $1::uuid AND variant = 'grid'
	`, fileID).Scan(&status, &objectID); err != nil {
		t.Fatalf("load thumbnail row: %v", err)
	}
	if status != "ready" || objectID == nil {
		t.Fatalf("thumbnail row status = %q object = %v", status, objectID)
	}

	redirect := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileID+"/thumbnail", nil)
	redirect.Header.Set("Cookie", cookieHeader(ownerCookies))
	redirectRecorder := httptest.NewRecorder()
	router.ServeHTTP(redirectRecorder, redirect)
	if redirectRecorder.Code != http.StatusTemporaryRedirect {
		t.Fatalf("resolve status = %d, want 307", redirectRecorder.Code)
	}
	if redirectRecorder.Header().Get("Location") == "" {
		t.Fatal("redirect location is empty")
	}
}

func validThumbnailPNG(t *testing.T) []byte {
	t.Helper()

	source := image.NewNRGBA(image.Rect(0, 0, 256, 128))
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, source); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buffer.Bytes()
}

func thumbnailRequest(t *testing.T, router http.Handler, cookies []*http.Cookie, fileID string, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequest(http.MethodPut, "/api/v1/files/"+fileID+"/thumbnail", body)
	request.Header.Set("Cookie", cookieHeader(cookies))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func cookieHeader(cookies []*http.Cookie) string {
	parts := make([]string, 0, len(cookies))
	for _, cookie := range cookies {
		parts = append(parts, cookie.Name+"="+cookie.Value)
	}
	return strings.Join(parts, "; ")
}

func loginForThumbnailTest(t *testing.T, router http.Handler, authConfig config.AuthConfig) []*http.Cookie {
	t.Helper()
	return loginThumbnailHelper(t, router, "alice", authConfig)
}

func loginForThumbnailTestGuest(t *testing.T, router http.Handler, authConfig config.AuthConfig) []*http.Cookie {
	t.Helper()
	return loginThumbnailHelper(t, router, "guest", authConfig)
}

func loginThumbnailHelper(t *testing.T, router http.Handler, username string, authConfig config.AuthConfig) []*http.Cookie {
	t.Helper()

	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(
		fmt.Sprintf(`{"username":%q,"password":"correct-horse-battery-staple"}`, username),
	))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("login %s status = %d, body = %s", username, recorder.Code, recorder.Body.String())
	}

	cookies := recorder.Result().Cookies()
	for _, cookie := range cookies {
		if cookie.Name == authConfig.Cookie.Name {
			return cookies
		}
	}
	t.Fatalf("login %s did not set session cookie", username)
	return nil
}

func createThumbnailFolder(t *testing.T, ctx context.Context, pool interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, ownerID, parentID, name string) string {
	t.Helper()

	display, key, err := nodes.NormalizeName(name)
	if err != nil {
		t.Fatalf("normalize %s: %v", name, err)
	}

	var id string
	var execErr error
	if parentID == "" {
		execErr = pool.QueryRow(ctx, `
			INSERT INTO nodes (kind, owner_user_id, parent_id, name, name_key, is_root, created_by)
			VALUES ('folder', $1::uuid, NULL, $2, $3, true, $1::uuid)
			RETURNING id::text
		`, ownerID, display, key).Scan(&id)
	} else {
		execErr = pool.QueryRow(ctx, `
			INSERT INTO nodes (kind, owner_user_id, parent_id, name, name_key, created_by)
			VALUES ('folder', $1::uuid, $2::uuid, $3, $4, $1::uuid)
			RETURNING id::text
		`, ownerID, parentID, display, key).Scan(&id)
	}
	if execErr != nil {
		t.Fatalf("create folder %s: %v", name, execErr)
	}
	return id
}

func createThumbnailFile(t *testing.T, ctx context.Context, pool interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, ownerID, parentID, name string, size int64) string {
	t.Helper()

	display, key, err := nodes.NormalizeName(name)
	if err != nil {
		t.Fatalf("normalize %s: %v", name, err)
	}

	var id string
	if err := pool.QueryRow(ctx, `
		WITH node AS (
			INSERT INTO nodes (kind, owner_user_id, parent_id, name, name_key, created_by)
			VALUES ('file', $1::uuid, $2::uuid, $3, $4, $1::uuid)
			RETURNING id
		),
		file AS (
			INSERT INTO files (
				node_id,
				size_bytes,
				chunk_size_bytes,
				mime_type,
				category,
				metadata_status
			)
			SELECT
				id,
				$5,
				10,
				'image/png',
				'image',
				'ready'
			FROM node
			RETURNING node_id
		),
		thumbnail AS (
			INSERT INTO file_thumbnails (file_id, variant, status)
			SELECT node_id, 'grid', 'pending'
			FROM file
			RETURNING file_id
		)
		SELECT file_id::text
		FROM thumbnail
	`, ownerID, parentID, display, key, size).Scan(&id); err != nil {
		t.Fatalf("create file %s: %v", name, err)
	}
	return id
}

type stubDirectObjectStore struct{}

func (s *stubDirectObjectStore) AcquireUploadBot(ctx context.Context, excludedBotUserIDs []string) (string, func(), error) {
	return "bot-1", func() {}, nil
}

func (s *stubDirectObjectStore) PutObject(ctx context.Context, filename string, r io.ReadSeeker, size int64, sha256 [32]byte) (blobstore.PutResult, error) {
	return blobstore.PutResult{
		Location: blobstore.Location{
			DiscordChannelID:    "channel",
			DiscordMessageID:    filename,
			DiscordAttachmentID: fmt.Sprintf("%d", size),
		},
		BotUserID:              "bot-1",
		AttachmentURL:          "https://cdn.example/" + filename,
		AttachmentURLExpiresAt: time.Now().Add(time.Hour),
	}, nil
}

func (s *stubDirectObjectStore) ResolveAttachmentURL(ctx context.Context, location blobstore.Location) (string, time.Time, error) {
	return "https://cdn.example/" + location.DiscordMessageID, time.Now().Add(time.Hour), nil
}

func (s *stubDirectObjectStore) DeleteObject(ctx context.Context, location blobstore.Location) error {
	return nil
}
