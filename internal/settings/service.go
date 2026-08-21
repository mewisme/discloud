package settings

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/postgres"
)

var (
	ErrInvalidTimezone           = errors.New("invalid timezone")
	ErrInvalidFileBrowserToolbar = errors.New("invalid file browser toolbar configuration")
	ErrInvalidFilePreview        = errors.New("invalid file preview configuration")
	ErrInvalidSidebar            = errors.New("invalid sidebar configuration")
	ErrInvalidConfigKey          = errors.New("invalid app config key")
	ErrInvalidConfigValue        = errors.New("invalid app config value")
	ErrAppConfigNotFound         = errors.New("app config not found")
)

var appConfigKeyPattern = regexp.MustCompile(`^[a-z0-9]+([._-][a-z0-9]+)*$`)

type Service struct {
	pool *pgxpool.Pool
}

type FileBrowserToolbarConfig struct {
	Variant      string `json:"variant"`
	DockPosition string `json:"dockPosition"`
}

type FilePreviewConfig struct {
	PreloadNext int `json:"preloadNext"`
}

type SidebarConfig struct {
	Side        string `json:"side"`
	Variant     string `json:"variant"`
	Collapsible string `json:"collapsible"`
}

type CommonUserConfig struct {
	Timezone           string                   `json:"timezone"`
	FileBrowserToolbar FileBrowserToolbarConfig `json:"fileBrowserToolbar"`
	FilePreview        FilePreviewConfig        `json:"filePreview"`
	Sidebar            SidebarConfig            `json:"sidebar"`
}

type CommonUserConfigPatch struct {
	Timezone           string
	FileBrowserToolbar *FileBrowserToolbarConfig
	FilePreview        *FilePreviewConfig
	Sidebar            *SidebarConfig
}

type UserConfig struct {
	Common   CommonUserConfig `json:"common"`
	Revision int64            `json:"revision"`
}

type AppConfigEntry struct {
	Key       string          `json:"key"`
	Value     json.RawMessage `json:"value"`
	Revision  int64           `json:"revision"`
	UpdatedBy *string         `json:"updatedBy"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type AppConfigList struct {
	Entries []AppConfigEntry `json:"entries"`
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) GetUserConfig(ctx context.Context, userID string) (UserConfig, error) {
	var raw []byte
	var revision int64

	err := s.pool.QueryRow(ctx, `
		SELECT config, revision
		FROM user_config
		WHERE user_id = $1::uuid
	`, userID).Scan(&raw, &revision)

	if errors.Is(err, pgx.ErrNoRows) {
		return defaultUserConfig(), nil
	}
	if err != nil {
		return UserConfig{}, fmt.Errorf("get user config: %w", err)
	}

	return decodeUserConfig(raw, revision)
}

func (s *Service) UpdateCommonUserConfig(ctx context.Context, userID string, input CommonUserConfigPatch) (UserConfig, error) {
	timezone, err := validateTimezone(input.Timezone)
	if err != nil {
		return UserConfig{}, err
	}

	commonPatch := map[string]any{
		"timezone": timezone,
	}

	if input.FileBrowserToolbar != nil {
		toolbar, err := validateFileBrowserToolbarConfig(*input.FileBrowserToolbar)
		if err != nil {
			return UserConfig{}, err
		}
		commonPatch["fileBrowserToolbar"] = toolbar
	}

	if input.FilePreview != nil {
		preview, err := validateFilePreviewConfig(*input.FilePreview)
		if err != nil {
			return UserConfig{}, err
		}
		commonPatch["filePreview"] = preview
	}

	if input.Sidebar != nil {
		sidebar, err := validateSidebarConfig(*input.Sidebar)
		if err != nil {
			return UserConfig{}, err
		}
		commonPatch["sidebar"] = sidebar
	}

	patchJSON, err := json.Marshal(commonPatch)
	if err != nil {
		return UserConfig{}, fmt.Errorf("encode common user config: %w", err)
	}

	var raw []byte
	var revision int64

	err = s.pool.QueryRow(ctx, `
		INSERT INTO user_config (
			user_id,
			config
		)
		VALUES (
			$1::uuid,
			jsonb_build_object('common', $2::jsonb)
		)
		ON CONFLICT (user_id)
		DO UPDATE SET
			config = jsonb_set(
				user_config.config,
				'{common}',
				(
					CASE
						WHEN jsonb_typeof(user_config.config->'common') = 'object'
							THEN user_config.config->'common'
						ELSE '{}'::jsonb
					END
				) || $2::jsonb,
				true
			),
			revision = user_config.revision + 1,
			updated_at = now()
		RETURNING config, revision
	`, userID, string(patchJSON)).Scan(&raw, &revision)
	if err != nil {
		return UserConfig{}, fmt.Errorf("update common user config: %w", err)
	}

	return decodeUserConfig(raw, revision)
}

func (s *Service) ListAppConfig(ctx context.Context, prefix string) (AppConfigList, error) {
	prefix = strings.TrimSpace(prefix)

	rows, err := s.pool.Query(ctx, `
		SELECT
			key,
			value,
			revision,
			updated_by::text,
			created_at,
			updated_at
		FROM app_config
		WHERE $1 = '' OR left(key, char_length($1)) = $1
		ORDER BY key
	`, prefix)
	if err != nil {
		return AppConfigList{}, fmt.Errorf("list app config: %w", err)
	}
	defer rows.Close()

	entries := make([]AppConfigEntry, 0)
	for rows.Next() {
		entry, err := scanAppConfig(rows)
		if err != nil {
			return AppConfigList{}, fmt.Errorf("scan app config: %w", err)
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return AppConfigList{}, fmt.Errorf("list app config rows: %w", err)
	}

	return AppConfigList{Entries: entries}, nil
}

func (s *Service) GetAppConfig(ctx context.Context, key string) (AppConfigEntry, error) {
	if err := validateAppConfigKey(key); err != nil {
		return AppConfigEntry{}, err
	}

	entry, err := scanAppConfig(s.pool.QueryRow(ctx, `
		SELECT
			key,
			value,
			revision,
			updated_by::text,
			created_at,
			updated_at
		FROM app_config
		WHERE key = $1
	`, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return AppConfigEntry{}, ErrAppConfigNotFound
	}
	if err != nil {
		return AppConfigEntry{}, fmt.Errorf("get app config: %w", err)
	}

	return entry, nil
}

func (s *Service) SetAppConfig(ctx context.Context, actorUserID, key string, value json.RawMessage) (AppConfigEntry, error) {
	if err := validateAppConfigKey(key); err != nil {
		return AppConfigEntry{}, err
	}

	value = bytes.TrimSpace(value)
	if len(value) == 0 || !json.Valid(value) {
		return AppConfigEntry{}, ErrInvalidConfigValue
	}

	var entry AppConfigEntry
	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		entry, err = scanAppConfig(tx.QueryRow(ctx, `
			INSERT INTO app_config (
				key,
				value,
				updated_by
			)
			VALUES (
				$1,
				$2::jsonb,
				NULLIF($3, '')::uuid
			)
			ON CONFLICT (key)
			DO UPDATE SET
				value = EXCLUDED.value,
				revision = app_config.revision + 1,
				updated_by = EXCLUDED.updated_by,
				updated_at = now()
			RETURNING
				key,
				value,
				revision,
				updated_by::text,
				created_at,
				updated_at
		`, key, string(value), actorUserID))
		if err != nil {
			return fmt.Errorf("set app config: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actorUserID,
			Action:       "app.config.set",
			ResourceType: "app_config",
			Metadata: map[string]any{
				"key":      key,
				"revision": entry.Revision,
			},
		})
	})
	if err != nil {
		return AppConfigEntry{}, err
	}

	return entry, nil
}

func (s *Service) DeleteAppConfig(ctx context.Context, actorUserID, key string) error {
	if err := validateAppConfigKey(key); err != nil {
		return err
	}

	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		var revision int64
		err := tx.QueryRow(ctx, `
			DELETE FROM app_config
			WHERE key = $1
			RETURNING revision
		`, key).Scan(&revision)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrAppConfigNotFound
		}
		if err != nil {
			return fmt.Errorf("delete app config: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actorUserID,
			Action:       "app.config.delete",
			ResourceType: "app_config",
			Metadata: map[string]any{
				"key":      key,
				"revision": revision,
			},
		})
	})
}

func defaultUserConfig() UserConfig {
	return UserConfig{
		Common: CommonUserConfig{
			Timezone:           "UTC",
			FileBrowserToolbar: defaultFileBrowserToolbarConfig(),
			FilePreview:        defaultFilePreviewConfig(),
			Sidebar:            defaultSidebarConfig(),
		},
	}
}

func defaultFileBrowserToolbarConfig() FileBrowserToolbarConfig {
	return FileBrowserToolbarConfig{
		Variant:      "inline",
		DockPosition: "bottom",
	}
}

func defaultFilePreviewConfig() FilePreviewConfig {
	return FilePreviewConfig{
		PreloadNext: 3,
	}
}

func defaultSidebarConfig() SidebarConfig {
	return SidebarConfig{
		Side:        "left",
		Variant:     "inset",
		Collapsible: "icon",
	}
}

func decodeUserConfig(raw []byte, revision int64) (UserConfig, error) {
	var stored struct {
		Common struct {
			Timezone           string                   `json:"timezone"`
			FileBrowserToolbar FileBrowserToolbarConfig `json:"fileBrowserToolbar"`
			FilePreview        FilePreviewConfig        `json:"filePreview"`
			Sidebar            SidebarConfig            `json:"sidebar"`
		} `json:"common"`
	}

	if err := json.Unmarshal(raw, &stored); err != nil {
		return UserConfig{}, fmt.Errorf("decode user config: %w", err)
	}

	timezone := strings.TrimSpace(stored.Common.Timezone)
	if timezone == "" {
		timezone = "UTC"
	} else if _, err := validateTimezone(timezone); err != nil {
		return UserConfig{}, fmt.Errorf("decode user config timezone: %w", err)
	}

	toolbar := defaultFileBrowserToolbarConfig()
	if strings.TrimSpace(stored.Common.FileBrowserToolbar.Variant) != "" {
		toolbar.Variant = stored.Common.FileBrowserToolbar.Variant
	}
	if strings.TrimSpace(stored.Common.FileBrowserToolbar.DockPosition) != "" {
		toolbar.DockPosition = stored.Common.FileBrowserToolbar.DockPosition
	}

	toolbar, err := validateFileBrowserToolbarConfig(toolbar)
	if err != nil {
		return UserConfig{}, fmt.Errorf("decode file browser toolbar config: %w", err)
	}

	preview := defaultFilePreviewConfig()
	if stored.Common.FilePreview.PreloadNext != 0 {
		preview.PreloadNext = stored.Common.FilePreview.PreloadNext
	}

	preview, err = validateFilePreviewConfig(preview)
	if err != nil {
		return UserConfig{}, fmt.Errorf("decode file preview config: %w", err)
	}

	sidebar := defaultSidebarConfig()
	if strings.TrimSpace(stored.Common.Sidebar.Side) != "" {
		sidebar.Side = stored.Common.Sidebar.Side
	}
	if strings.TrimSpace(stored.Common.Sidebar.Variant) != "" {
		sidebar.Variant = stored.Common.Sidebar.Variant
	}
	if strings.TrimSpace(stored.Common.Sidebar.Collapsible) != "" {
		sidebar.Collapsible = stored.Common.Sidebar.Collapsible
	}

	sidebar, err = validateSidebarConfig(sidebar)
	if err != nil {
		return UserConfig{}, fmt.Errorf("decode sidebar config: %w", err)
	}

	return UserConfig{
		Common: CommonUserConfig{
			Timezone:           timezone,
			FileBrowserToolbar: toolbar,
			FilePreview:        preview,
			Sidebar:            sidebar,
		},
		Revision: revision,
	}, nil
}

func validateTimezone(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || value == "Local" || len(value) > 128 {
		return "", ErrInvalidTimezone
	}
	if _, err := time.LoadLocation(value); err != nil {
		return "", ErrInvalidTimezone
	}

	return value, nil
}

func validateFileBrowserToolbarConfig(value FileBrowserToolbarConfig) (FileBrowserToolbarConfig, error) {
	value.Variant = strings.TrimSpace(value.Variant)
	value.DockPosition = strings.TrimSpace(value.DockPosition)

	if value.Variant != "inline" && value.Variant != "dock" {
		return FileBrowserToolbarConfig{}, ErrInvalidFileBrowserToolbar
	}
	if value.DockPosition != "bottom" && value.DockPosition != "right" {
		return FileBrowserToolbarConfig{}, ErrInvalidFileBrowserToolbar
	}

	return value, nil
}

func validateFilePreviewConfig(value FilePreviewConfig) (FilePreviewConfig, error) {
	if value.PreloadNext < 3 || value.PreloadNext > 5 {
		return FilePreviewConfig{}, ErrInvalidFilePreview
	}

	return value, nil
}

func validateSidebarConfig(value SidebarConfig) (SidebarConfig, error) {
	value.Side = strings.TrimSpace(value.Side)
	value.Variant = strings.TrimSpace(value.Variant)
	value.Collapsible = strings.TrimSpace(value.Collapsible)

	if value.Side != "left" && value.Side != "right" {
		return SidebarConfig{}, ErrInvalidSidebar
	}
	if value.Variant != "sidebar" && value.Variant != "floating" && value.Variant != "inset" {
		return SidebarConfig{}, ErrInvalidSidebar
	}
	if value.Collapsible != "offcanvas" && value.Collapsible != "icon" && value.Collapsible != "none" {
		return SidebarConfig{}, ErrInvalidSidebar
	}

	return value, nil
}

func validateAppConfigKey(key string) error {
	if len(key) == 0 || len(key) > 128 || !appConfigKeyPattern.MatchString(key) {
		return ErrInvalidConfigKey
	}

	return nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanAppConfig(row rowScanner) (AppConfigEntry, error) {
	var entry AppConfigEntry
	var value []byte

	err := row.Scan(
		&entry.Key,
		&value,
		&entry.Revision,
		&entry.UpdatedBy,
		&entry.CreatedAt,
		&entry.UpdatedAt,
	)
	if err != nil {
		return AppConfigEntry{}, err
	}

	entry.Value = append(json.RawMessage(nil), value...)
	return entry, nil
}
