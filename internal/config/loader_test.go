package config

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestLoad_Defaults(t *testing.T) {
	cfg, err := load(mapLookup(nil))
	if err != nil {
		t.Fatalf("load defaults: %v", err)
	}

	if cfg.HTTP.ListenAddress != ":8080" {
		t.Fatalf(
			"ListenAddress = %q, want %q",
			cfg.HTTP.ListenAddress,
			":8080",
		)
	}

	if cfg.Auth.Cookie.Name != "discloud_session" {
		t.Fatalf(
			"Cookie.Name = %q, want %q",
			cfg.Auth.Cookie.Name,
			"discloud_session",
		)
	}

	if !cfg.Auth.Cookie.Secure {
		t.Fatal(
			"Cookie.Secure = false, want true",
		)
	}

	if cfg.Upload.ChunkSizeBytes != 10*1024*1024 {
		t.Fatalf(
			"ChunkSizeBytes = %d, want %d",
			cfg.Upload.ChunkSizeBytes,
			10*1024*1024,
		)
	}

	if cfg.Upload.SessionTTL != 48*time.Hour {
		t.Fatalf(
			"SessionTTL = %s, want %s",
			cfg.Upload.SessionTTL,
			48*time.Hour,
		)
	}

	if cfg.Log.Level != LogLevelInfo {
		t.Fatalf(
			"Log.Level = %q, want %q",
			cfg.Log.Level,
			LogLevelInfo,
		)
	}
}

func TestLoad_EnvironmentOverrides(t *testing.T) {
	masterKey := []byte(
		"01234567890123456789012345678901",
	)

	values := map[string]string{
		envHTTPListenAddress: ":9000",

		envPublicBaseURL: "https://files.example.com/base",

		envHTTPReadHeaderTimeout: "7s",

		envHTTPIdleTimeout: "3m",

		envHTTPShutdownTimeout: "20s",

		envHTTPMaxHeaderBytes: "2097152",

		envHTTPTrustedProxies: "10.0.0.1, 10.0.0.2",

		envHTTPCORSAllowedOrigins: "https://app.example.com\n" +
			"https://admin.example.com",

		envDatabaseDSN: "postgres://user:pass@db/discloud",

		envDatabaseMinConnections: "2",

		envDatabaseMaxConnections: "30",

		envDatabaseMaxConnectionLife: "2h",

		envDatabaseMaxConnectionIdle: "45m",

		envDatabaseHealthCheckPeriod: "30s",

		envAuthSessionTTL: "336h",

		envAuthCookieName: "dc_session",

		envAuthCookieDomain: "example.com",

		envAuthCookiePath: "/api",

		envAuthCookieSecure: "false",

		envAuthCookieSameSite: "STRICT",

		envMFAIssuer: "My DisCloud",

		envEncryptionMasterKeyBase64: base64.StdEncoding.EncodeToString(
			masterKey,
		),

		envDiscordGuildID: "guild-1",

		envDiscordChannelID: "channel-1",

		envDiscordBotTokens: "bot-a, bot-b\nbot-c",

		envUploadChunkSize: "20MiB",

		envUploadSessionTTL: "72h",

		envJobsWorkerCount: "6",

		envLogLevel: "DEBUG",
	}

	cfg, err := load(
		mapLookup(values),
	)
	if err != nil {
		t.Fatalf(
			"load overrides: %v",
			err,
		)
	}

	if got := cfg.HTTP.PublicBaseURL.String(); got != "https://files.example.com/base" {
		t.Fatalf(
			"PublicBaseURL = %q",
			got,
		)
	}

	if cfg.Database.MaxConnections != 30 {
		t.Fatalf(
			"MaxConnections = %d, want 30",
			cfg.Database.MaxConnections,
		)
	}

	if cfg.Auth.Cookie.SameSite != SameSiteStrict {
		t.Fatalf(
			"SameSite = %q, want %q",
			cfg.Auth.Cookie.SameSite,
			SameSiteStrict,
		)
	}

	if string(cfg.Encryption.MasterKey) != string(masterKey) {
		t.Fatal(
			"MasterKey was not decoded correctly",
		)
	}

	if len(cfg.Discord.Bots) != 3 {
		t.Fatalf(
			"len(Bots) = %d, want 3",
			len(cfg.Discord.Bots),
		)
	}

	for i, want := range []string{
		"bot-a",
		"bot-b",
		"bot-c",
	} {
		got := cfg.Discord.Bots[i].Token

		if got != want {
			t.Fatalf(
				"Bots[%d].Token = %q, want %q",
				i,
				got,
				want,
			)
		}
	}

	if cfg.Upload.ChunkSizeBytes != 20*1024*1024 {
		t.Fatalf(
			"ChunkSizeBytes = %d, want %d",
			cfg.Upload.ChunkSizeBytes,
			20*1024*1024,
		)
	}

	if cfg.Log.Level != LogLevelDebug {
		t.Fatalf(
			"Log.Level = %q, want %q",
			cfg.Log.Level,
			LogLevelDebug,
		)
	}
}

func TestLoad_DoesNotPerformSemanticValidation(
	t *testing.T,
) {
	cfg, err := load(
		mapLookup(
			map[string]string{
				envUploadChunkSize: "21MiB",
			},
		),
	)
	if err != nil {
		t.Fatalf(
			"load: %v",
			err,
		)
	}

	if cfg.Upload.ChunkSizeBytes != 21*1024*1024 {
		t.Fatalf(
			"ChunkSizeBytes = %d, want %d",
			cfg.Upload.ChunkSizeBytes,
			21*1024*1024,
		)
	}
}

func TestLoad_InvalidMasterKeyDoesNotLeakSecret(
	t *testing.T,
) {
	secret := "this-is-not-valid-base64!"

	_, err := load(
		mapLookup(
			map[string]string{
				envEncryptionMasterKeyBase64: secret,
			},
		),
	)

	if err == nil {
		t.Fatal("expected error")
	}

	if !strings.Contains(
		err.Error(),
		envEncryptionMasterKeyBase64,
	) {
		t.Fatalf(
			"error %q does not mention environment variable",
			err,
		)
	}

	if strings.Contains(
		err.Error(),
		secret,
	) {
		t.Fatalf(
			"error leaked secret value: %q",
			err,
		)
	}
}

func TestParseByteSize(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		want    int64
		wantErr bool
	}{
		{
			name:  "raw bytes",
			value: "10485760",
			want:  10485760,
		},
		{
			name:  "bytes suffix",
			value: "1024B",
			want:  1024,
		},
		{
			name:  "kibibytes",
			value: "512KiB",
			want:  512 * 1024,
		},
		{
			name:  "mebibytes",
			value: "10MiB",
			want:  10 * 1024 * 1024,
		},
		{
			name:  "case insensitive",
			value: "20mib",
			want:  20 * 1024 * 1024,
		},
		{
			name:  "spaces",
			value: " 15 MiB ",
			want:  15 * 1024 * 1024,
		},
		{
			name:    "empty",
			value:   "",
			wantErr: true,
		},
		{
			name:    "invalid unit",
			value:   "10MB",
			wantErr: true,
		},
		{
			name:    "invalid number",
			value:   "tenMiB",
			wantErr: true,
		},
		{
			name:    "overflow",
			value:   "9223372036854775807MiB",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(
			tt.name,
			func(t *testing.T) {
				got, err := parseByteSize(
					tt.value,
				)

				if tt.wantErr {
					if err == nil {
						t.Fatalf(
							"parseByteSize(%q) expected error",
							tt.value,
						)
					}

					return
				}

				if err != nil {
					t.Fatalf(
						"parseByteSize(%q): %v",
						tt.value,
						err,
					)
				}

				if got != tt.want {
					t.Fatalf(
						"parseByteSize(%q) = %d, want %d",
						tt.value,
						got,
						tt.want,
					)
				}
			},
		)
	}
}

func mapLookup(
	values map[string]string,
) lookupEnvFunc {
	return func(
		key string,
	) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}
