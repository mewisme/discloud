package config

import (
	"encoding/base64"
	"fmt"
	"math"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	envHTTPListenAddress         = "DISCLOUD_HTTP_LISTEN_ADDRESS"
	envPublicBaseURL             = "DISCLOUD_PUBLIC_BASE_URL"
	envHTTPReadHeaderTimeout     = "DISCLOUD_HTTP_READ_HEADER_TIMEOUT"
	envHTTPIdleTimeout           = "DISCLOUD_HTTP_IDLE_TIMEOUT"
	envHTTPShutdownTimeout       = "DISCLOUD_HTTP_SHUTDOWN_TIMEOUT"
	envHTTPMaxHeaderBytes        = "DISCLOUD_HTTP_MAX_HEADER_BYTES"
	envHTTPTrustedProxies        = "DISCLOUD_HTTP_TRUSTED_PROXIES"
	envHTTPCORSAllowedOrigins    = "DISCLOUD_HTTP_CORS_ALLOWED_ORIGINS"
	envDatabaseDSN               = "DISCLOUD_DATABASE_DSN"
	envDatabaseMinConnections    = "DISCLOUD_DATABASE_MIN_CONNECTIONS"
	envDatabaseMaxConnections    = "DISCLOUD_DATABASE_MAX_CONNECTIONS"
	envDatabaseMaxConnectionLife = "DISCLOUD_DATABASE_MAX_CONNECTION_LIFE"
	envDatabaseMaxConnectionIdle = "DISCLOUD_DATABASE_MAX_CONNECTION_IDLE"
	envDatabaseHealthCheckPeriod = "DISCLOUD_DATABASE_HEALTH_CHECK_PERIOD"
	envAuthSessionTTL            = "DISCLOUD_AUTH_SESSION_TTL"
	envAuthCookieName            = "DISCLOUD_AUTH_COOKIE_NAME"
	envAuthCookieDomain          = "DISCLOUD_AUTH_COOKIE_DOMAIN"
	envAuthCookiePath            = "DISCLOUD_AUTH_COOKIE_PATH"
	envAuthCookieSecure          = "DISCLOUD_AUTH_COOKIE_SECURE"
	envAuthCookieSameSite        = "DISCLOUD_AUTH_COOKIE_SAME_SITE"
	envMFAIssuer                 = "DISCLOUD_MFA_ISSUER"
	envEncryptionMasterKeyBase64 = "DISCLOUD_ENCRYPTION_MASTER_KEY_BASE64"
	envDiscordGuildID            = "DISCLOUD_DISCORD_GUILD_ID"
	envDiscordChannelID          = "DISCLOUD_DISCORD_CHANNEL_ID"
	envDiscordBotTokens          = "DISCLOUD_DISCORD_BOT_TOKENS"
	envUploadChunkSize           = "DISCLOUD_UPLOAD_CHUNK_SIZE"
	envUploadSessionTTL          = "DISCLOUD_UPLOAD_SESSION_TTL"
	envJobsWorkerCount           = "DISCLOUD_JOBS_WORKER_COUNT"
	envLogLevel                  = "DISCLOUD_LOG_LEVEL"
)

type lookupEnvFunc func(string) (string, bool)

func Load() (Config, error) {
	return load(os.LookupEnv)
}

func load(lookup lookupEnvFunc) (Config, error) {
	cfg := defaultConfig()
	var err error

	if value, ok := lookup(envHTTPListenAddress); ok {
		cfg.HTTP.ListenAddress = strings.TrimSpace(value)
	}

	if value, ok := lookup(envPublicBaseURL); ok {
		cfg.HTTP.PublicBaseURL, err = parseURL(value)
		if err != nil {
			return Config{}, envParseError(envPublicBaseURL, err)
		}
	}

	if cfg.HTTP.ReadHeaderTimeout, err = durationEnv(
		lookup,
		envHTTPReadHeaderTimeout,
		cfg.HTTP.ReadHeaderTimeout,
	); err != nil {
		return Config{}, err
	}

	if cfg.HTTP.IdleTimeout, err = durationEnv(
		lookup,
		envHTTPIdleTimeout,
		cfg.HTTP.IdleTimeout,
	); err != nil {
		return Config{}, err
	}

	if cfg.HTTP.ShutdownTimeout, err = durationEnv(
		lookup,
		envHTTPShutdownTimeout,
		cfg.HTTP.ShutdownTimeout,
	); err != nil {
		return Config{}, err
	}

	if cfg.HTTP.MaxHeaderBytes, err = intEnv(
		lookup,
		envHTTPMaxHeaderBytes,
		cfg.HTTP.MaxHeaderBytes,
	); err != nil {
		return Config{}, err
	}

	cfg.HTTP.TrustedProxies = listEnv(
		lookup,
		envHTTPTrustedProxies,
		cfg.HTTP.TrustedProxies,
	)

	cfg.HTTP.CORS.AllowedOrigins = listEnv(
		lookup,
		envHTTPCORSAllowedOrigins,
		cfg.HTTP.CORS.AllowedOrigins,
	)

	if value, ok := lookup(envDatabaseDSN); ok {
		cfg.Database.DSN = strings.TrimSpace(value)
	}

	if cfg.Database.MinConnections, err = int32Env(
		lookup,
		envDatabaseMinConnections,
		cfg.Database.MinConnections,
	); err != nil {
		return Config{}, err
	}

	if cfg.Database.MaxConnections, err = int32Env(
		lookup,
		envDatabaseMaxConnections,
		cfg.Database.MaxConnections,
	); err != nil {
		return Config{}, err
	}

	if cfg.Database.MaxConnectionLife, err = durationEnv(
		lookup,
		envDatabaseMaxConnectionLife,
		cfg.Database.MaxConnectionLife,
	); err != nil {
		return Config{}, err
	}

	if cfg.Database.MaxConnectionIdle, err = durationEnv(
		lookup,
		envDatabaseMaxConnectionIdle,
		cfg.Database.MaxConnectionIdle,
	); err != nil {
		return Config{}, err
	}

	if cfg.Database.HealthCheckPeriod, err = durationEnv(
		lookup,
		envDatabaseHealthCheckPeriod,
		cfg.Database.HealthCheckPeriod,
	); err != nil {
		return Config{}, err
	}

	if cfg.Auth.SessionTTL, err = durationEnv(
		lookup,
		envAuthSessionTTL,
		cfg.Auth.SessionTTL,
	); err != nil {
		return Config{}, err
	}

	if value, ok := lookup(envAuthCookieName); ok {
		cfg.Auth.Cookie.Name = strings.TrimSpace(value)
	}

	if value, ok := lookup(envAuthCookieDomain); ok {
		cfg.Auth.Cookie.Domain = strings.TrimSpace(value)
	}

	if value, ok := lookup(envAuthCookiePath); ok {
		cfg.Auth.Cookie.Path = strings.TrimSpace(value)
	}

	if cfg.Auth.Cookie.Secure, err = boolEnv(
		lookup,
		envAuthCookieSecure,
		cfg.Auth.Cookie.Secure,
	); err != nil {
		return Config{}, err
	}

	if value, ok := lookup(envAuthCookieSameSite); ok {
		cfg.Auth.Cookie.SameSite = SameSiteMode(
			strings.ToLower(strings.TrimSpace(value)),
		)
	}

	if value, ok := lookup(envMFAIssuer); ok {
		cfg.MFA.Issuer = strings.TrimSpace(value)
	}

	if value, ok := lookup(envEncryptionMasterKeyBase64); ok {
		cfg.Encryption.MasterKey, err = decodeBase64(value)
		if err != nil {
			return Config{}, envParseError(
				envEncryptionMasterKeyBase64,
				err,
			)
		}
	}

	if value, ok := lookup(envDiscordGuildID); ok {
		cfg.Discord.GuildID = strings.TrimSpace(value)
	}

	if value, ok := lookup(envDiscordChannelID); ok {
		cfg.Discord.ChannelID = strings.TrimSpace(value)
	}

	if value, ok := lookup(envDiscordBotTokens); ok {
		cfg.Discord.Bots = botConfigs(value)
	}

	if value, ok := lookup(envUploadChunkSize); ok {
		cfg.Upload.ChunkSizeBytes, err = parseByteSize(value)
		if err != nil {
			return Config{}, envParseError(
				envUploadChunkSize,
				err,
			)
		}
	}

	if cfg.Upload.SessionTTL, err = durationEnv(
		lookup,
		envUploadSessionTTL,
		cfg.Upload.SessionTTL,
	); err != nil {
		return Config{}, err
	}

	if cfg.Jobs.WorkerCount, err = intEnv(
		lookup,
		envJobsWorkerCount,
		cfg.Jobs.WorkerCount,
	); err != nil {
		return Config{}, err
	}

	if value, ok := lookup(envLogLevel); ok {
		cfg.Log.Level = LogLevel(
			strings.ToLower(strings.TrimSpace(value)),
		)
	}

	return cfg, nil
}

func defaultConfig() Config {
	return Config{
		HTTP: HTTPConfig{
			ListenAddress:     ":8080",
			ReadHeaderTimeout: 5 * time.Second,
			IdleTimeout:       2 * time.Minute,
			ShutdownTimeout:   15 * time.Second,
			MaxHeaderBytes:    1 << 20,
		},
		Database: DatabaseConfig{
			MinConnections:    0,
			MaxConnections:    10,
			MaxConnectionLife: time.Hour,
			MaxConnectionIdle: 30 * time.Minute,
			HealthCheckPeriod: time.Minute,
		},
		Auth: AuthConfig{
			SessionTTL: 30 * 24 * time.Hour,
			Cookie: CookieConfig{
				Name:     "discloud_session",
				Path:     "/",
				Secure:   true,
				SameSite: SameSiteLax,
			},
		},
		MFA: MFAConfig{
			Issuer: "DisCloud",
		},
		Discord: DiscordConfig{
			Bots: []DiscordBotConfig{},
		},
		Upload: UploadConfig{
			ChunkSizeBytes: DefaultUploadChunkSize,
			SessionTTL:     48 * time.Hour,
		},
		Jobs: JobsConfig{
			WorkerCount: 4,
		},
		Log: LogConfig{
			Level: LogLevelInfo,
		},
	}
}

func parseURL(value string) (*url.URL, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}

	return url.Parse(value)
}

func decodeBase64(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}

	encodings := []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	}

	var lastErr error

	for _, encoding := range encodings {
		decoded, err := encoding.DecodeString(value)
		if err == nil {
			return decoded, nil
		}

		lastErr = err
	}

	return nil, lastErr
}

func parseByteSize(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, fmt.Errorf("value is empty")
	}

	lower := strings.ToLower(value)
	multiplier := int64(1)
	number := lower

	switch {
	case strings.HasSuffix(lower, "mib"):
		multiplier = 1024 * 1024
		number = strings.TrimSpace(
			lower[:len(lower)-3],
		)

	case strings.HasSuffix(lower, "kib"):
		multiplier = 1024
		number = strings.TrimSpace(
			lower[:len(lower)-3],
		)

	case strings.HasSuffix(lower, "b"):
		number = strings.TrimSpace(
			lower[:len(lower)-1],
		)
	}

	n, err := strconv.ParseInt(number, 10, 64)
	if err != nil {
		return 0, err
	}

	if n > 0 && n > math.MaxInt64/multiplier {
		return 0, fmt.Errorf("value overflows int64")
	}

	return n * multiplier, nil
}

func botConfigs(value string) []DiscordBotConfig {
	tokens := splitList(value)

	bots := make(
		[]DiscordBotConfig,
		0,
		len(tokens),
	)

	for _, token := range tokens {
		bots = append(
			bots,
			DiscordBotConfig{
				Token: token,
			},
		)
	}

	return bots
}

func listEnv(
	lookup lookupEnvFunc,
	key string,
	fallback []string,
) []string {
	value, ok := lookup(key)
	if !ok {
		return fallback
	}

	return splitList(value)
}

func splitList(value string) []string {
	fields := strings.FieldsFunc(
		value,
		func(r rune) bool {
			return r == ',' ||
				r == '\n' ||
				r == '\r'
		},
	)

	result := make(
		[]string,
		0,
		len(fields),
	)

	for _, field := range fields {
		field = strings.TrimSpace(field)

		if field != "" {
			result = append(
				result,
				field,
			)
		}
	}

	return result
}

func durationEnv(
	lookup lookupEnvFunc,
	key string,
	fallback time.Duration,
) (time.Duration, error) {
	value, ok := lookup(key)
	if !ok {
		return fallback, nil
	}

	parsed, err := time.ParseDuration(
		strings.TrimSpace(value),
	)
	if err != nil {
		return 0, envParseError(key, err)
	}

	return parsed, nil
}

func intEnv(
	lookup lookupEnvFunc,
	key string,
	fallback int,
) (int, error) {
	value, ok := lookup(key)
	if !ok {
		return fallback, nil
	}

	parsed, err := strconv.Atoi(
		strings.TrimSpace(value),
	)
	if err != nil {
		return 0, envParseError(key, err)
	}

	return parsed, nil
}

func int32Env(
	lookup lookupEnvFunc,
	key string,
	fallback int32,
) (int32, error) {
	value, ok := lookup(key)
	if !ok {
		return fallback, nil
	}

	parsed, err := strconv.ParseInt(
		strings.TrimSpace(value),
		10,
		32,
	)
	if err != nil {
		return 0, envParseError(key, err)
	}

	return int32(parsed), nil
}

func boolEnv(
	lookup lookupEnvFunc,
	key string,
	fallback bool,
) (bool, error) {
	value, ok := lookup(key)
	if !ok {
		return fallback, nil
	}

	parsed, err := strconv.ParseBool(
		strings.TrimSpace(value),
	)
	if err != nil {
		return false, envParseError(key, err)
	}

	return parsed, nil
}

func envParseError(
	key string,
	err error,
) error {
	return fmt.Errorf(
		"parse %s: %w",
		key,
		err,
	)
}
