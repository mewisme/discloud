package discordstore

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBaseURL   = "https://discord.com/api/v10"
	defaultUserAgent = "DiscordBot (https://github.com/mewisme/discloud, 0.1)"
	maxErrorBody     = 1 << 20
)

type Client struct {
	httpClient *http.Client
	baseURL    string
	userAgent  string
}

type User struct {
	ID  string `json:"id"`
	Bot bool   `json:"bot"`
}

type Attachment struct {
	ID   string `json:"id"`
	Size int64  `json:"size"`
	URL  string `json:"url"`
}

type Message struct {
	ID          string       `json:"id"`
	ChannelID   string       `json:"channel_id"`
	Attachments []Attachment `json:"attachments"`
}

func NewClient(httpClient *http.Client) *Client {
	return NewClientWithBaseURL(httpClient, defaultBaseURL)
}

func NewClientWithBaseURL(httpClient *http.Client, baseURL string) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	return &Client{
		httpClient: httpClient,
		baseURL:    strings.TrimRight(baseURL, "/"),
		userAgent:  defaultUserAgent,
	}
}

func (c *Client) CurrentUser(ctx context.Context, token string) (User, error) {
	var user User
	if err := c.doJSON(ctx, http.MethodGet, "/users/@me", token, "", nil, &user); err != nil {
		return User{}, err
	}
	return user, nil
}

func (c *Client) CreateMessage(
	ctx context.Context,
	token string,
	channelID string,
	contentType string,
	body io.Reader,
) (Message, error) {
	var message Message
	path := "/channels/" + url.PathEscape(channelID) + "/messages"

	if err := c.doJSON(
		ctx,
		http.MethodPost,
		path,
		token,
		contentType,
		body,
		&message,
	); err != nil {
		return Message{}, err
	}

	return message, nil
}

func (c *Client) GetMessage(
	ctx context.Context,
	token string,
	channelID string,
	messageID string,
) (Message, error) {
	var message Message
	path := "/channels/" +
		url.PathEscape(channelID) +
		"/messages/" +
		url.PathEscape(messageID)

	if err := c.doJSON(ctx, http.MethodGet, path, token, "", nil, &message); err != nil {
		return Message{}, err
	}

	return message, nil
}

func (c *Client) OpenAttachment(
	ctx context.Context,
	rawURL string,
	rangeHeader string,
) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create attachment request: %w", err)
	}

	req.Header.Set("User-Agent", c.userAgent)
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		err := readAPIError(resp)
		resp.Body.Close()
		return nil, err
	}

	return resp, nil
}

func (c *Client) doJSON(
	ctx context.Context,
	method string,
	path string,
	token string,
	contentType string,
	body io.Reader,
	dst any,
) error {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return fmt.Errorf("create Discord request: %w", err)
	}

	req.Header.Set("Authorization", "Bot "+token)
	req.Header.Set("User-Agent", c.userAgent)

	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return readAPIError(resp)
	}

	if dst == nil {
		return nil
	}

	if err := json.NewDecoder(io.LimitReader(resp.Body, maxErrorBody)).Decode(dst); err != nil {
		return fmt.Errorf("decode Discord response: %w", err)
	}

	return nil
}

func readAPIError(resp *http.Response) error {
	data, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBody))

	var payload struct {
		Message    string  `json:"message"`
		RetryAfter float64 `json:"retry_after"`
		Global     bool    `json:"global"`
	}
	_ = json.Unmarshal(data, &payload)

	retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"))
	if retryAfter == 0 && payload.RetryAfter > 0 {
		retryAfter = time.Duration(payload.RetryAfter * float64(time.Second))
	}

	return &APIError{
		StatusCode: resp.StatusCode,
		RetryAfter: retryAfter,
		Global:     payload.Global,
		Message:    payload.Message,
	}
}

func parseRetryAfter(value string) time.Duration {
	if value == "" {
		return 0
	}

	seconds, err := strconv.ParseFloat(value, 64)
	if err != nil || seconds <= 0 {
		return 0
	}

	return time.Duration(seconds * float64(time.Second))
}
