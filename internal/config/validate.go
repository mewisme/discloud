package config

import (
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

func (cfg Config) Validate() error {
	var errs []error
	add := func(condition bool, format string, args ...any) {
		if condition {
			errs = append(errs, fmt.Errorf(format, args...))
		}
	}

	add(strings.TrimSpace(cfg.HTTP.ListenAddress) == "", "HTTP listen address is required")
	add(!validPublicURL(cfg.HTTP.PublicBaseURL), "public base URL must be an absolute HTTP or HTTPS URL")
	add(cfg.HTTP.ReadHeaderTimeout <= 0, "HTTP read header timeout must be greater than zero")
	add(cfg.HTTP.IdleTimeout <= 0, "HTTP idle timeout must be greater than zero")
	add(cfg.HTTP.ShutdownTimeout <= 0, "HTTP shutdown timeout must be greater than zero")
	add(cfg.HTTP.MaxHeaderBytes <= 0, "HTTP max header bytes must be greater than zero")

	for _, proxy := range cfg.HTTP.TrustedProxies {
		add(!validIPOrPrefix(proxy), "invalid trusted proxy %q", proxy)
	}
	for _, origin := range cfg.HTTP.CORS.AllowedOrigins {
		add(!validOrigin(origin), "invalid CORS origin %q", origin)
	}

	add(strings.TrimSpace(cfg.Database.DSN) == "", "database DSN is required")
	add(cfg.Database.MinConnections < 0, "database min connections cannot be negative")
	add(cfg.Database.MaxConnections <= 0, "database max connections must be greater than zero")
	add(cfg.Database.MinConnections > cfg.Database.MaxConnections, "database min connections cannot exceed max connections")
	add(cfg.Database.MaxConnectionLife <= 0, "database max connection life must be greater than zero")
	add(cfg.Database.MaxConnectionIdle <= 0, "database max connection idle must be greater than zero")
	add(cfg.Database.HealthCheckPeriod <= 0, "database health check period must be greater than zero")

	add(cfg.Auth.SessionTTL <= 0, "auth session TTL must be greater than zero")
	add(strings.TrimSpace(cfg.Auth.Cookie.Name) == "", "auth cookie name is required")
	add(!strings.HasPrefix(cfg.Auth.Cookie.Path, "/"), "auth cookie path must start with /")
	add(!validSameSite(cfg.Auth.Cookie.SameSite), "invalid auth cookie SameSite value %q", cfg.Auth.Cookie.SameSite)
	add(cfg.Auth.Cookie.SameSite == SameSiteNone && !cfg.Auth.Cookie.Secure, "SameSite=none requires a secure auth cookie")

	add(strings.TrimSpace(cfg.MFA.Issuer) == "", "MFA issuer is required")
	add(len(cfg.Encryption.MasterKey) != EncryptionMasterKeySize, "encryption master key must be exactly %d bytes", EncryptionMasterKeySize)

	add(!validSnowflake(cfg.Discord.GuildID), "Discord guild ID must be a valid snowflake")
	add(!validSnowflake(cfg.Discord.ChannelID), "Discord channel ID must be a valid snowflake")
	validateDiscordBots(cfg.Discord.Bots, &errs)
	add(cfg.Discord.MaxConcurrentUploads <= 0, "Discord max concurrent uploads must be greater than zero")
	add(cfg.Discord.MaxConcurrentDownloads <= 0, "Discord max concurrent downloads must be greater than zero")

	add(cfg.Upload.ChunkSizeBytes <= 0, "upload chunk size must be greater than zero")
	add(cfg.Upload.ChunkSizeBytes > MaxUploadChunkSize, "upload chunk size cannot exceed %d bytes", MaxUploadChunkSize)
	add(cfg.Upload.SessionTTL <= 0, "upload session TTL must be greater than zero")
	add(cfg.Jobs.WorkerCount <= 0, "job worker count must be greater than zero")
	add(!validLogLevel(cfg.Log.Level), "invalid log level %q", cfg.Log.Level)

	return errors.Join(errs...)
}

func validateDiscordBots(bots []DiscordBotConfig, errs *[]error) {
	if len(bots) == 0 {
		*errs = append(*errs, errors.New("at least one Discord bot token is required"))
		return
	}

	seen := make(map[string]struct{}, len(bots))
	for i, bot := range bots {
		token := strings.TrimSpace(bot.Token)
		if token == "" {
			*errs = append(*errs, fmt.Errorf("Discord bot token at index %d is empty", i))
			continue
		}
		if _, ok := seen[token]; ok {
			*errs = append(*errs, fmt.Errorf("Discord bot token at index %d is duplicated", i))
			continue
		}
		seen[token] = struct{}{}
	}
}

func validPublicURL(value *url.URL) bool {
	if value == nil || value.Host == "" || (value.Scheme != "http" && value.Scheme != "https") {
		return false
	}
	return value.RawQuery == "" && value.Fragment == ""
}

func validOrigin(value string) bool {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	return (u.Path == "" || u.Path == "/") && u.RawQuery == "" && u.Fragment == "" && u.User == nil
}

func validIPOrPrefix(value string) bool {
	value = strings.TrimSpace(value)
	if _, err := netip.ParseAddr(value); err == nil {
		return true
	}
	_, err := netip.ParsePrefix(value)
	return err == nil
}

func validSnowflake(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	_, err := strconv.ParseUint(value, 10, 64)
	return err == nil
}

func validSameSite(value SameSiteMode) bool {
	switch value {
	case SameSiteLax, SameSiteStrict, SameSiteNone:
		return true
	default:
		return false
	}
}

func validLogLevel(value LogLevel) bool {
	switch value {
	case LogLevelDebug, LogLevelInfo, LogLevelWarn, LogLevelError:
		return true
	default:
		return false
	}
}
