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

func TestValidatePaginationConfig(t *testing.T) {
	t.Parallel()

	for _, mode := range []string{"infinite", "manual"} {
		config, err := validatePaginationConfig(PaginationConfig{Mode: mode})
		if err != nil {
			t.Fatalf("validatePaginationConfig(%q): %v", mode, err)
		}
		if config.Mode != mode {
			t.Fatalf("mode = %q, want %q", config.Mode, mode)
		}
	}

	for _, mode := range []string{"", "auto", "page", "infinite-scroll"} {
		if _, err := validatePaginationConfig(PaginationConfig{Mode: mode}); !errors.Is(err, ErrInvalidPagination) {
			t.Fatalf("validatePaginationConfig(%q) error = %v, want ErrInvalidPagination", mode, err)
		}
	}
}

func TestValidateFilePreviewConfig(t *testing.T) {
	t.Parallel()

	for preloadNext := 3; preloadNext <= 10; preloadNext++ {
		config, err := validateFilePreviewConfig(FilePreviewConfig{PreloadNext: preloadNext})
		if err != nil {
			t.Fatalf("validateFilePreviewConfig(%d): %v", preloadNext, err)
		}
		if config.PreloadNext != preloadNext {
			t.Fatalf("preloadNext = %d, want %d", config.PreloadNext, preloadNext)
		}
	}

	for _, preloadNext := range []int{0, 1, 2, 11, 20} {
		if _, err := validateFilePreviewConfig(FilePreviewConfig{PreloadNext: preloadNext}); !errors.Is(err, ErrInvalidFilePreview) {
			t.Fatalf("validateFilePreviewConfig(%d) error = %v, want ErrInvalidFilePreview", preloadNext, err)
		}
	}
}

func TestValidateSidebarConfig(t *testing.T) {
	t.Parallel()

	for _, config := range []SidebarConfig{
		{Side: "left", Variant: "sidebar", Collapsible: "offcanvas"},
		{Side: "left", Variant: "floating", Collapsible: "icon"},
		{Side: "right", Variant: "sidebar", Collapsible: "icon"},
		{Side: "right", Variant: "floating", Collapsible: "offcanvas"},
	} {
		if _, err := validateSidebarConfig(config); err != nil {
			t.Fatalf("validateSidebarConfig(%+v): %v", config, err)
		}
	}

	for _, config := range []SidebarConfig{
		{Side: "", Variant: "sidebar", Collapsible: "icon"},
		{Side: "top", Variant: "sidebar", Collapsible: "icon"},
		{Side: "left", Variant: "", Collapsible: "icon"},
		{Side: "left", Variant: "card", Collapsible: "icon"},
		{Side: "left", Variant: "inset", Collapsible: "icon"},
		{Side: "left", Variant: "sidebar", Collapsible: ""},
		{Side: "left", Variant: "sidebar", Collapsible: "collapsed"},
	} {
		if _, err := validateSidebarConfig(config); !errors.Is(err, ErrInvalidSidebar) {
			t.Fatalf("validateSidebarConfig(%+v) error = %v, want ErrInvalidSidebar", config, err)
		}
	}
}

func TestDecodeUserConfigDefaultsLegacyPreferences(t *testing.T) {
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
	if config.Common.Pagination.Mode != "infinite" {
		t.Fatalf("pagination mode = %q, want infinite", config.Common.Pagination.Mode)
	}
	if config.Common.FileBrowserToolbar.DockPosition != "bottom" {
		t.Fatalf("toolbar dock position = %q, want bottom", config.Common.FileBrowserToolbar.DockPosition)
	}
	if config.Common.FilePreview.PreloadNext != 3 {
		t.Fatalf("preview preloadNext = %d, want 3", config.Common.FilePreview.PreloadNext)
	}
	if config.Common.Sidebar.Side != "left" {
		t.Fatalf("sidebar side = %q, want left", config.Common.Sidebar.Side)
	}
	if config.Common.Sidebar.Variant != "sidebar" {
		t.Fatalf("sidebar variant = %q, want sidebar", config.Common.Sidebar.Variant)
	}
	if config.Common.Sidebar.Collapsible != "icon" {
		t.Fatalf("sidebar collapsible = %q, want icon", config.Common.Sidebar.Collapsible)
	}
	if config.Revision != 7 {
		t.Fatalf("revision = %d, want 7", config.Revision)
	}
}

func TestDecodeUserConfigFilePreview(t *testing.T) {
	t.Parallel()

	config, err := decodeUserConfig([]byte(`{"common":{"timezone":"UTC","filePreview":{"preloadNext":10}}}`), 2)
	if err != nil {
		t.Fatalf("decodeUserConfig: %v", err)
	}

	if config.Common.FilePreview.PreloadNext != 10 {
		t.Fatalf("preview preloadNext = %d, want 10", config.Common.FilePreview.PreloadNext)
	}
}

func TestDecodeUserConfigPagination(t *testing.T) {
	t.Parallel()

	config, err := decodeUserConfig([]byte(`{"common":{"timezone":"UTC","pagination":{"mode":"manual"}}}`), 3)
	if err != nil {
		t.Fatalf("decodeUserConfig: %v", err)
	}

	if config.Common.Pagination.Mode != "manual" {
		t.Fatalf("pagination mode = %q, want manual", config.Common.Pagination.Mode)
	}
}

func TestDecodeUserConfigSidebar(t *testing.T) {
	t.Parallel()

	config, err := decodeUserConfig([]byte(`{"common":{"timezone":"UTC","sidebar":{"side":"right","variant":"floating","collapsible":"offcanvas"}}}`), 4)
	if err != nil {
		t.Fatalf("decodeUserConfig: %v", err)
	}

	if config.Common.Sidebar.Side != "right" {
		t.Fatalf("sidebar side = %q, want right", config.Common.Sidebar.Side)
	}
	if config.Common.Sidebar.Variant != "floating" {
		t.Fatalf("sidebar variant = %q, want floating", config.Common.Sidebar.Variant)
	}
	if config.Common.Sidebar.Collapsible != "offcanvas" {
		t.Fatalf("sidebar collapsible = %q, want offcanvas", config.Common.Sidebar.Collapsible)
	}
}

func TestDecodeUserConfigLegacyInsetSidebar(t *testing.T) {
	t.Parallel()

	config, err := decodeUserConfig([]byte(`{"common":{"timezone":"UTC","sidebar":{"side":"right","variant":"inset","collapsible":"none"}}}`), 5)
	if err != nil {
		t.Fatalf("decodeUserConfig: %v", err)
	}

	if config.Common.Sidebar.Side != "right" {
		t.Fatalf("sidebar side = %q, want right", config.Common.Sidebar.Side)
	}
	if config.Common.Sidebar.Variant != "sidebar" {
		t.Fatalf("sidebar variant = %q, want sidebar", config.Common.Sidebar.Variant)
	}
	if config.Common.Sidebar.Collapsible != "none" {
		t.Fatalf("sidebar collapsible = %q, want none", config.Common.Sidebar.Collapsible)
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
