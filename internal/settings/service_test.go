package settings

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestValidateTimezone(t *testing.T) {
	t.Parallel()

	for _, timezone := range []string{
		"UTC",
		"Asia/Bangkok",
		"America/New_York",
		"Europe/London",
	} {
		if _, err := validateTimezone(timezone); err != nil {
			t.Fatalf("validateTimezone(%q): %v", timezone, err)
		}
	}

	for _, timezone := range []string{"", "Local", "UTC+7", "Not/A_Timezone"} {
		if _, err := validateTimezone(timezone); !errors.Is(err, ErrInvalidTimezone) {
			t.Fatalf("validateTimezone(%q) error = %v, want ErrInvalidTimezone", timezone, err)
		}
	}
}

func TestValidateAppConfigKey(t *testing.T) {
	t.Parallel()

	for _, key := range []string{
		"web.instance_name",
		"backend.maintenance_mode",
		"features.public-shares",
		"desktop.auto_update",
	} {
		if err := validateAppConfigKey(key); err != nil {
			t.Fatalf("validateAppConfigKey(%q): %v", key, err)
		}
	}

	for _, key := range []string{
		"",
		"Web.Name",
		"web name",
		".web",
		"web.",
		"web..name",
		"web/name",
	} {
		if err := validateAppConfigKey(key); !errors.Is(err, ErrInvalidConfigKey) {
			t.Fatalf("validateAppConfigKey(%q) error = %v, want ErrInvalidConfigKey", key, err)
		}
	}
}

func TestAppConfigValueJSON(t *testing.T) {
	t.Parallel()

	for _, value := range []json.RawMessage{
		json.RawMessage(`true`),
		json.RawMessage(`42`),
		json.RawMessage(`"DisCloud"`),
		json.RawMessage(`{"enabled":true}`),
	} {
		if !json.Valid(value) {
			t.Fatalf("expected valid JSON: %s", value)
		}
	}
}
