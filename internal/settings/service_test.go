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

func TestValidateFileBrowserToolbarConfig(t *testing.T) {
	t.Parallel()

	for _, config := range []FileBrowserToolbarConfig{
		{Variant: "inline", DockPosition: "bottom"},
		{Variant: "inline", DockPosition: "right"},
		{Variant: "dock", DockPosition: "bottom"},
		{Variant: "dock", DockPosition: "right"},
	} {
		if _, err := validateFileBrowserToolbarConfig(config); err != nil {
			t.Fatalf("validateFileBrowserToolbarConfig(%+v): %v", config, err)
		}
	}

	for _, config := range []FileBrowserToolbarConfig{
		{Variant: "", DockPosition: "bottom"},
		{Variant: "floating", DockPosition: "bottom"},
		{Variant: "dock", DockPosition: ""},
		{Variant: "dock", DockPosition: "left"},
	} {
		if _, err := validateFileBrowserToolbarConfig(config); !errors.Is(err, ErrInvalidFileBrowserToolbar) {
			t.Fatalf("validateFileBrowserToolbarConfig(%+v) error = %v, want ErrInvalidFileBrowserToolbar", config, err)
		}
	}
}

func TestDecodeUserConfigDefaultsLegacyToolbar(t *testing.T) {
	t.Parallel()

	config, err := decodeUserConfig([]byte(`{"common":{"timezone":"Asia/Bangkok"}}`), 7)
	if err != nil {
		t.Fatalf("decodeUserConfig: %v", err)
	}

	if config.Common.Timezone != "Asia/Bangkok" {
		t.Fatalf("timezone = %q, want Asia/Bangkok", config.Common.Timezone)
	}
	if config.Common.FileBrowserToolbar.Variant != "inline" {
		t.Fatalf("toolbar variant = %q, want inline", config.Common.FileBrowserToolbar.Variant)
	}
	if config.Common.FileBrowserToolbar.DockPosition != "bottom" {
		t.Fatalf("toolbar dock position = %q, want bottom", config.Common.FileBrowserToolbar.DockPosition)
	}
	if config.Revision != 7 {
		t.Fatalf("revision = %d, want 7", config.Revision)
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
