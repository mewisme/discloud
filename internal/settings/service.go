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
	ErrInvalidTimezone    = errors.New("invalid timezone")
	ErrInvalidConfigKey   = errors.New("invalid app config key")
	ErrInvalidConfigValue = errors.New("invalid app config value")
	ErrAppConfigNotFound  = errors.New("app config not found")
)

var appConfigKeyPattern = regexp.MustCompile(`^[a-z0-9]+([._-][a-z0-9]+)*$`)

type Service struct {
	pool *pgxpool.Pool
}

type CommonUserConfig struct {
	Timezone string `json:"timezone"`
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

func (s *Service) UpdateCommonUserConfig(ctx context.Context, userID, timezone string) (UserConfig, error) {
	timezone, err := validateTimezone(timezone)
	if err != nil {
		return UserConfig{}, err
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
			jsonb_build_object(
				'common',
				jsonb_build_object('timezone', $2::text)
			)
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
				) || jsonb_build_object('timezone', $2::text),
				true
			),
			revision = user_config.revision + 1,
			updated_at = now()
		RETURNING config, revision
	`, userID, timezone).Scan(&raw, &revision)
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
			Timezone: "UTC",
		},
	}
}

func decodeUserConfig(raw []byte, revision int64) (UserConfig, error) {
	var stored struct {
		Common struct {
			Timezone string `json:"timezone"`
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

	return UserConfig{
		Common: CommonUserConfig{
			Timezone: timezone,
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
