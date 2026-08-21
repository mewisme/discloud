package config

import (
	"net/url"
	"time"
)

const (
	DefaultUploadChunkSize      int64 = 10 * 1024 * 1024
	MaxUploadChunkSize          int64 = 20 * 1024 * 1024
	DefaultUploadMediaChunkSize int64 = 5 * 1024 * 1024
	MinUploadMediaChunkSize     int64 = 1 * 1024 * 1024
	MaxUploadMediaChunkSize     int64 = 5 * 1024 * 1024
	EncryptionMasterKeySize           = 32
)

type Config struct {
	HTTP       HTTPConfig
	Database   DatabaseConfig
	Auth       AuthConfig
	MFA        MFAConfig
	Encryption EncryptionConfig
	Discord    DiscordConfig
	Upload     UploadConfig
	Jobs       JobsConfig
	Log        LogConfig
}

type HTTPConfig struct {
	ListenAddress     string
	PublicBaseURL     *url.URL
	ReadHeaderTimeout time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration
	MaxHeaderBytes    int

	TrustedProxies []string
	CORS           CORSConfig
}

type CORSConfig struct {
	AllowedOrigins []string
}

type DatabaseConfig struct {
	DSN string

	MinConnections    int32
	MaxConnections    int32
	MaxConnectionLife time.Duration
	MaxConnectionIdle time.Duration
	HealthCheckPeriod time.Duration
}

type AuthConfig struct {
	SessionTTL time.Duration
	Cookie     CookieConfig
}

type CookieConfig struct {
	Name     string
	Domain   string
	Path     string
	Secure   bool
	SameSite SameSiteMode
}

type SameSiteMode string

const (
	SameSiteLax    SameSiteMode = "lax"
	SameSiteStrict SameSiteMode = "strict"
	SameSiteNone   SameSiteMode = "none"
)

type MFAConfig struct {
	Issuer string
}

type EncryptionConfig struct {
	MasterKey []byte
}

type DiscordConfig struct {
	GuildID   string
	ChannelID string
	Bots      []DiscordBotConfig
}

type DiscordBotConfig struct {
	Token string
}

type UploadConfig struct {
	ChunkSizeBytes      int64
	MediaChunkSizeBytes int64
	SessionTTL          time.Duration
}

type JobsConfig struct {
	WorkerCount int
}

type LogConfig struct {
	Level LogLevel
}

type LogLevel string

const (
	LogLevelDebug LogLevel = "debug"
	LogLevelInfo  LogLevel = "info"
	LogLevelWarn  LogLevel = "warn"
	LogLevelError LogLevel = "error"
)
