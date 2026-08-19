package discordstore

import (
	"context"
	"net/http"
	"net/url"
)

func (c *Client) DeleteMessage(ctx context.Context, token, channelID, messageID string) error {
	path := "/channels/" +
		url.PathEscape(channelID) +
		"/messages/" +
		url.PathEscape(messageID)

	return c.doJSON(ctx, http.MethodDelete, path, token, "", nil, nil)
}
