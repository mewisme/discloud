package httpapi

import (
	"net/http/httptest"
	"testing"

	"github.com/mewisme/discloud/internal/config"
)

func TestRequestIPIgnoresForwardedForFromUntrustedPeer(t *testing.T) {
	r := httptest.NewRequest("GET", "http://example.test", nil)
	r.RemoteAddr = "203.0.113.10:1234"
	r.Header.Set("X-Forwarded-For", "198.51.100.20")
	if got := requestIP(r, config.HTTPConfig{TrustedProxies: []string{"10.0.0.2"}}); got != "203.0.113.10" {
		t.Fatalf("requestIP() = %q, want %q", got, "203.0.113.10")
	}
}

func TestRequestIPWalksTrustedProxyChain(t *testing.T) {
	r := httptest.NewRequest("GET", "http://example.test", nil)
	r.RemoteAddr = "10.0.0.3:1234"
	r.Header.Set("X-Forwarded-For", "198.51.100.20, 10.0.0.2")
	cfg := config.HTTPConfig{TrustedProxies: []string{"10.0.0.2", "10.0.0.3"}}
	if got := requestIP(r, cfg); got != "198.51.100.20" {
		t.Fatalf("requestIP() = %q, want %q", got, "198.51.100.20")
	}
}

func TestRequestIPRejectsMalformedForwardedFor(t *testing.T) {
	r := httptest.NewRequest("GET", "http://example.test", nil)
	r.RemoteAddr = "10.0.0.2:1234"
	r.Header.Set("X-Forwarded-For", "not-an-ip")
	cfg := config.HTTPConfig{TrustedProxies: []string{"10.0.0.2"}}
	if got := requestIP(r, cfg); got != "10.0.0.2" {
		t.Fatalf("requestIP() = %q, want trusted peer", got)
	}
}

func TestRequestIsHTTPSTrustsForwardedProtoOnlyFromTrustedProxy(t *testing.T) {
	cfg := config.HTTPConfig{TrustedProxies: []string{"10.0.0.2"}}
	untrusted := httptest.NewRequest("GET", "http://example.test", nil)
	untrusted.RemoteAddr = "203.0.113.10:1234"
	untrusted.Header.Set("X-Forwarded-Proto", "https")
	if requestIsHTTPS(untrusted, cfg) {
		t.Fatal("untrusted X-Forwarded-Proto unexpectedly marked request secure")
	}

	trusted := httptest.NewRequest("GET", "http://example.test", nil)
	trusted.RemoteAddr = "10.0.0.2:1234"
	trusted.Header.Set("X-Forwarded-Proto", "https")
	if !requestIsHTTPS(trusted, cfg) {
		t.Fatal("trusted X-Forwarded-Proto did not mark request secure")
	}

	trusted.Header.Set("X-Forwarded-Proto", "https, http")
	if requestIsHTTPS(trusted, cfg) {
		t.Fatal("forwarded proto did not use the immediate trusted proxy value")
	}
}
