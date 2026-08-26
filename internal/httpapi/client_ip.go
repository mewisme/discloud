package httpapi

import (
	"net"
	"net/http"
	"strings"

	"github.com/mewisme/discloud/internal/config"
)

func requestIP(r *http.Request, cfg config.HTTPConfig) string {
	remote := remoteIP(r.RemoteAddr)
	if remote == "" || !trustedProxyIP(remote, cfg) {
		return remote
	}

	forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
	if forwarded == "" {
		return remote
	}

	chain := strings.Split(forwarded, ",")
	for i := len(chain) - 1; i >= 0; i-- {
		candidate := strings.TrimSpace(chain[i])
		if net.ParseIP(candidate) == nil {
			return remote
		}
		if !trustedProxyIP(candidate, cfg) {
			return candidate
		}
	}
	return strings.TrimSpace(chain[0])
}

func requestFromTrustedProxy(r *http.Request, cfg config.HTTPConfig) bool {
	remote := remoteIP(r.RemoteAddr)
	return remote != "" && trustedProxyIP(remote, cfg)
}

func forwardedProto(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if value == "" {
		return ""
	}
	parts := strings.Split(value, ",")
	return strings.ToLower(strings.TrimSpace(parts[len(parts)-1]))
}

func remoteIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil && net.ParseIP(host) != nil {
		return host
	}
	remoteAddr = strings.TrimSpace(remoteAddr)
	if net.ParseIP(remoteAddr) != nil {
		return remoteAddr
	}
	return ""
}

func trustedProxyIP(ip string, cfg config.HTTPConfig) bool {
	candidate := net.ParseIP(ip)
	if candidate == nil {
		return false
	}
	for _, trusted := range cfg.TrustedProxies {
		trustedIP := net.ParseIP(strings.TrimSpace(trusted))
		if trustedIP != nil && trustedIP.Equal(candidate) {
			return true
		}
	}
	return false
}
