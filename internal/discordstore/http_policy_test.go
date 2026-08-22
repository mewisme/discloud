package discordstore

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestDiscordHTTPTimeoutPolicies(t *testing.T) {
	client := NewClient(nil)

	if client.httpClient.Timeout != discordAPITimeout {
		t.Fatalf("API timeout = %s, want %s", client.httpClient.Timeout, discordAPITimeout)
	}
	if client.uploadHTTPClient.Timeout != discordUploadTimeout {
		t.Fatalf("upload timeout = %s, want %s", client.uploadHTTPClient.Timeout, discordUploadTimeout)
	}
	if client.attachmentHTTPClient.Timeout != 0 {
		t.Fatalf("attachment total timeout = %s, want 0", client.attachmentHTTPClient.Timeout)
	}

	apiTransport := requireHTTPTransport(t, client.httpClient)
	uploadTransport := requireHTTPTransport(t, client.uploadHTTPClient)
	attachmentTransport := requireHTTPTransport(t, client.attachmentHTTPClient)

	if apiTransport == uploadTransport ||
		apiTransport == attachmentTransport ||
		uploadTransport == attachmentTransport {
		t.Fatal("Discord HTTP planes unexpectedly share transport instances")
	}

	assertTransportPolicy(t, apiTransport, discordAPIResponseHeaderTimeout)
	assertTransportPolicy(t, uploadTransport, discordUploadResponseHeaderTimeout)
	assertTransportPolicy(t, attachmentTransport, discordCDNResponseHeaderTimeout)
}

func TestDiscordHTTPPolicyDoesNotMutateProvidedClient(t *testing.T) {
	baseTransport := http.DefaultTransport.(*http.Transport).Clone()
	baseTransport.ResponseHeaderTimeout = 37 * time.Second
	baseTransport.IdleConnTimeout = 41 * time.Second
	baseTransport.MaxIdleConns = 7
	baseTransport.MaxIdleConnsPerHost = 3

	base := &http.Client{
		Transport: baseTransport,
		Timeout:   43 * time.Second,
	}

	client := NewClientWithBaseURL(base, "https://discord.example/api")

	if base.Timeout != 43*time.Second {
		t.Fatalf("provided client timeout mutated to %s", base.Timeout)
	}
	if baseTransport.ResponseHeaderTimeout != 37*time.Second {
		t.Fatalf("provided response header timeout mutated to %s", baseTransport.ResponseHeaderTimeout)
	}
	if baseTransport.IdleConnTimeout != 41*time.Second {
		t.Fatalf("provided idle timeout mutated to %s", baseTransport.IdleConnTimeout)
	}
	if baseTransport.MaxIdleConns != 7 {
		t.Fatalf("provided max idle conns mutated to %d", baseTransport.MaxIdleConns)
	}
	if baseTransport.MaxIdleConnsPerHost != 3 {
		t.Fatalf("provided max idle conns per host mutated to %d", baseTransport.MaxIdleConnsPerHost)
	}

	if client.httpClient == base ||
		client.uploadHTTPClient == base ||
		client.attachmentHTTPClient == base {
		t.Fatal("Discord client reused provided http.Client instance")
	}
	if client.httpClient.Transport == base.Transport ||
		client.uploadHTTPClient.Transport == base.Transport ||
		client.attachmentHTTPClient.Transport == base.Transport {
		t.Fatal("Discord client reused provided transport instance")
	}
}

func TestDiscordClientUsesSeparateHTTPPlanes(t *testing.T) {
	var controlRequests, uploadRequests, attachmentRequests int

	client := &Client{
		httpClient: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			controlRequests++
			return testHTTPResponse(req, `{"id":"bot-1","bot":true}`), nil
		})},
		uploadHTTPClient: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			uploadRequests++
			return testHTTPResponse(req, `{"id":"message-1","channel_id":"channel-1","attachments":[]}`), nil
		})},
		attachmentHTTPClient: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			attachmentRequests++
			return testHTTPResponse(req, "chunk"), nil
		})},
		baseURL:   "https://discord.example/api",
		userAgent: defaultUserAgent,
	}

	if _, err := client.CurrentUser(t.Context(), "token"); err != nil {
		t.Fatalf("CurrentUser(): %v", err)
	}

	if _, err := client.CreateMessage(
		t.Context(),
		"token",
		"channel-1",
		"application/octet-stream",
		strings.NewReader("payload"),
	); err != nil {
		t.Fatalf("CreateMessage(): %v", err)
	}

	response, err := client.OpenAttachment(
		t.Context(),
		"https://cdn.example/chunk",
		"",
	)
	if err != nil {
		t.Fatalf("OpenAttachment(): %v", err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	response.Body.Close()

	if controlRequests != 1 {
		t.Fatalf("control requests = %d, want 1", controlRequests)
	}
	if uploadRequests != 1 {
		t.Fatalf("upload requests = %d, want 1", uploadRequests)
	}
	if attachmentRequests != 1 {
		t.Fatalf("attachment requests = %d, want 1", attachmentRequests)
	}
}

func requireHTTPTransport(t *testing.T, client *http.Client) *http.Transport {
	t.Helper()

	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport = %T, want *http.Transport", client.Transport)
	}
	return transport
}

func assertTransportPolicy(t *testing.T, transport *http.Transport, responseHeaderTimeout time.Duration) {
	t.Helper()

	if transport.DialContext == nil {
		t.Fatal("DialContext is nil")
	}
	if transport.TLSHandshakeTimeout != discordTLSHandshakeTimeout {
		t.Fatalf("TLS handshake timeout = %s, want %s", transport.TLSHandshakeTimeout, discordTLSHandshakeTimeout)
	}
	if transport.ResponseHeaderTimeout != responseHeaderTimeout {
		t.Fatalf("response header timeout = %s, want %s", transport.ResponseHeaderTimeout, responseHeaderTimeout)
	}
	if transport.ExpectContinueTimeout != discordExpectContinueTimeout {
		t.Fatalf("expect-continue timeout = %s, want %s", transport.ExpectContinueTimeout, discordExpectContinueTimeout)
	}
	if transport.IdleConnTimeout != discordIdleConnTimeout {
		t.Fatalf("idle connection timeout = %s, want %s", transport.IdleConnTimeout, discordIdleConnTimeout)
	}
	if transport.MaxIdleConns != discordMaxIdleConns {
		t.Fatalf("max idle connections = %d, want %d", transport.MaxIdleConns, discordMaxIdleConns)
	}
	if transport.MaxIdleConnsPerHost != discordMaxIdleConnsPerHost {
		t.Fatalf("max idle connections per host = %d, want %d", transport.MaxIdleConnsPerHost, discordMaxIdleConnsPerHost)
	}
	if !transport.ForceAttemptHTTP2 {
		t.Fatal("HTTP/2 attempts are disabled")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func testHTTPResponse(req *http.Request, body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    req,
	}
}
