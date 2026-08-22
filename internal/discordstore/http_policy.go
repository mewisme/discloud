package discordstore

import (
	"net"
	"net/http"
	"time"
)

const (
	discordAPITimeout                  = 15 * time.Second
	discordUploadTimeout               = 2 * time.Minute
	discordDialTimeout                 = 5 * time.Second
	discordKeepAlive                   = 30 * time.Second
	discordTLSHandshakeTimeout         = 5 * time.Second
	discordAPIResponseHeaderTimeout    = 10 * time.Second
	discordUploadResponseHeaderTimeout = 15 * time.Second
	discordCDNResponseHeaderTimeout    = 15 * time.Second
	discordIdleConnTimeout             = 90 * time.Second
	discordExpectContinueTimeout       = time.Second
	discordMaxIdleConns                = 64
	discordMaxIdleConnsPerHost         = 16
)

func newDiscordHTTPClients(base *http.Client) (*http.Client, *http.Client, *http.Client) {
	return newDiscordHTTPClient(base, discordAPITimeout, discordAPIResponseHeaderTimeout),
		newDiscordHTTPClient(base, discordUploadTimeout, discordUploadResponseHeaderTimeout),
		newDiscordHTTPClient(base, 0, discordCDNResponseHeaderTimeout)
}

func newDiscordHTTPClient(base *http.Client, timeout, responseHeaderTimeout time.Duration) *http.Client {
	client := &http.Client{}
	if base != nil {
		*client = *base
	}

	client.Timeout = timeout
	client.Transport = cloneDiscordTransport(client.Transport, responseHeaderTimeout)
	return client
}

func cloneDiscordTransport(base http.RoundTripper, responseHeaderTimeout time.Duration) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}

	transport, ok := base.(*http.Transport)
	if !ok {
		return base
	}

	transport = transport.Clone()

	dialer := &net.Dialer{
		Timeout:   discordDialTimeout,
		KeepAlive: discordKeepAlive,
	}

	transport.DialContext = dialer.DialContext
	transport.TLSHandshakeTimeout = discordTLSHandshakeTimeout
	transport.ResponseHeaderTimeout = responseHeaderTimeout
	transport.ExpectContinueTimeout = discordExpectContinueTimeout
	transport.IdleConnTimeout = discordIdleConnTimeout
	transport.MaxIdleConns = discordMaxIdleConns
	transport.MaxIdleConnsPerHost = discordMaxIdleConnsPerHost
	transport.ForceAttemptHTTP2 = true

	return transport
}
