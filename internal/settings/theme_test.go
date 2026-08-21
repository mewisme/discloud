package settings

import (
	"errors"
	"testing"
)

func TestValidateThemeConfig(t *testing.T) {
	t.Parallel()

	for _, effect := range []string{
		"triangle",
		"triangle-blur",
		"circle",
		"circle-blur",
		"circle-blur-top-left",
		"polygon",
		"polygon-gradient",
	} {
		config, err := validateThemeConfig(ThemeConfig{Effect: effect})
		if err != nil {
			t.Fatalf("validateThemeConfig(%q): %v", effect, err)
		}
		if config.Effect != effect {
			t.Fatalf("effect = %q, want %q", config.Effect, effect)
		}
	}

	for _, effect := range []string{"", "none", "fade", "random"} {
		if _, err := validateThemeConfig(ThemeConfig{Effect: effect}); !errors.Is(err, ErrInvalidTheme) {
			t.Fatalf("validateThemeConfig(%q) error = %v, want ErrInvalidTheme", effect, err)
		}
	}
}

func TestDecodeUserConfigDefaultsTheme(t *testing.T) {
	t.Parallel()

	config, err := decodeUserConfig([]byte(`{"common":{"timezone":"UTC"}}`), 1)
	if err != nil {
		t.Fatalf("decodeUserConfig: %v", err)
	}

	if config.Common.Theme.Effect != "triangle" {
		t.Fatalf("theme effect = %q, want triangle", config.Common.Theme.Effect)
	}
}

func TestDecodeUserConfigTheme(t *testing.T) {
	t.Parallel()

	config, err := decodeUserConfig([]byte(`{"common":{"timezone":"UTC","theme":{"effect":"polygon-gradient"}}}`), 3)
	if err != nil {
		t.Fatalf("decodeUserConfig: %v", err)
	}

	if config.Common.Theme.Effect != "polygon-gradient" {
		t.Fatalf("theme effect = %q, want polygon-gradient", config.Common.Theme.Effect)
	}
}
