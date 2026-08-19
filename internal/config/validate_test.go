package config

import (
	"net/url"
	"strings"
	"testing"
)

func TestConfigValidate(t *testing.T) {
	if err := validConfig().Validate(); err != nil {
		t.Fatalf("Validate() unexpected error: %v", err)
	}
}

func TestConfigValidateErrors(t *testing.T) {
	tests := []struct {
		name   string
		update func(*Config)
		want   string
	}{
		{
			name: "missing database DSN",
			update: func(cfg *Config) {
				cfg.Database.DSN = ""
			},
			want: "database DSN is required",
		},
		{
			name: "invalid public URL",
			update: func(cfg *Config) {
				cfg.HTTP.PublicBaseURL = &url.URL{Path: "/relative"}
			},
			want: "public base URL",
		},
		{
			name: "invalid pool range",
			update: func(cfg *Config) {
				cfg.Database.MinConnections = 20
				cfg.Database.MaxConnections = 10
			},
			want: "min connections cannot exceed",
		},
		{
			name: "invalid encryption key",
			update: func(cfg *Config) {
				cfg.Encryption.MasterKey = []byte("short")
			},
			want: "exactly 32 bytes",
		},
		{
			name: "missing bots",
			update: func(cfg *Config) {
				cfg.Discord.Bots = nil
			},
			want: "at least one Discord bot token",
		},
		{
			name: "duplicate bot",
			update: func(cfg *Config) {
				cfg.Discord.Bots = []DiscordBotConfig{{Token: "same"}, {Token: "same"}}
			},
			want: "duplicated",
		},
		{
			name: "chunk exceeds maximum",
			update: func(cfg *Config) {
				cfg.Upload.ChunkSizeBytes = MaxUploadChunkSize + 1
			},
			want: "upload chunk size cannot exceed",
		},
		{
			name: "invalid SameSite",
			update: func(cfg *Config) {
				cfg.Auth.Cookie.SameSite = "invalid"
			},
			want: "invalid auth cookie SameSite",
		},
		{
			name: "insecure SameSite none",
			update: func(cfg *Config) {
				cfg.Auth.Cookie.SameSite = SameSiteNone
				cfg.Auth.Cookie.Secure = false
			},
			want: "SameSite=none requires",
		},
		{
			name: "invalid trusted proxy",
			update: func(cfg *Config) {
				cfg.HTTP.TrustedProxies = []string{"not-an-ip"}
			},
			want: "invalid trusted proxy",
		},
		{
			name: "invalid CORS origin",
			update: func(cfg *Config) {
				cfg.HTTP.CORS.AllowedOrigins = []string{"example.com"}
			},
			want: "invalid CORS origin",
		},
		{
			name: "invalid Discord guild ID",
			update: func(cfg *Config) {
				cfg.Discord.GuildID = "guild"
			},
			want: "Discord guild ID",
		},
		{
			name: "invalid worker count",
			update: func(cfg *Config) {
				cfg.Jobs.WorkerCount = 0
			},
			want: "job worker count",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := validConfig()
			tt.update(&cfg)

			err := cfg.Validate()
			if err == nil {
				t.Fatal("Validate() expected error")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("Validate() error = %q, want containing %q", err, tt.want)
			}
		})
	}
}

func TestConfigValidateCollectsErrors(t *testing.T) {
	cfg := validConfig()
	cfg.Database.DSN = ""
	cfg.Discord.Bots = nil
	cfg.Upload.ChunkSizeBytes = MaxUploadChunkSize + 1

	err := cfg.Validate()
	if err == nil {
		t.Fatal("Validate() expected error")
	}

	for _, want := range []string{"database DSN", "Discord bot token", "upload chunk size"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("Validate() error = %q, want containing %q", err, want)
		}
	}
}

func validConfig() Config {
	cfg := defaultConfig()
	cfg.HTTP.PublicBaseURL = mustURL("https://files.example.com")
	cfg.Database.DSN = "postgres://discloud:secret@localhost:5432/discloud"
	cfg.Encryption.MasterKey = make([]byte, EncryptionMasterKeySize)
	cfg.Discord.GuildID = "123456789012345678"
	cfg.Discord.ChannelID = "234567890123456789"
	cfg.Discord.Bots = []DiscordBotConfig{{Token: "bot-token-a"}, {Token: "bot-token-b"}}
	return cfg
}

func mustURL(value string) *url.URL {
	u, err := url.Parse(value)
	if err != nil {
		panic(err)
	}
	return u
}
