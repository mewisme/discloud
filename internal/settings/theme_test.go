package settings

import (
	"errors"
	"strings"
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
		"custom",
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

func TestValidateThemeConfigCustomCSSLimit(t *testing.T) {
	t.Parallel()

	config := ThemeConfig{
		Effect: "custom",
		Custom: CustomThemeEffectConfig{
			CSS: strings.Repeat("a", maxCustomThemeCSSBytes+1),
		},
	}

	if _, err := validateThemeConfig(config); !errors.Is(err, ErrInvalidTheme) {
		t.Fatalf("validateThemeConfig custom CSS error = %v, want ErrInvalidTheme", err)
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
	if config.Common.Theme.Custom.CSS != "" {
		t.Fatalf("theme custom CSS = %q, want empty", config.Common.Theme.Custom.CSS)
	}
}

func TestDecodeUserConfigCustomTheme(t *testing.T) {
	t.Parallel()

	config, err := decodeUserConfig([]byte(`{"common":{"timezone":"UTC","theme":{"effect":"custom","custom":{"css":"::view-transition-new(root){animation:none}"}}}}`), 3)
	if err != nil {
		t.Fatalf("decodeUserConfig: %v", err)
	}

	if config.Common.Theme.Effect != "custom" {
		t.Fatalf("theme effect = %q, want custom", config.Common.Theme.Effect)
	}
	if config.Common.Theme.Custom.CSS != "::view-transition-new(root){animation:none}" {
		t.Fatalf("unexpected custom CSS: %q", config.Common.Theme.Custom.CSS)
	}
}
