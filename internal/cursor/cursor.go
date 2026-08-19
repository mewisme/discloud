package cursor

import (
	"encoding/base64"
	"encoding/json"
	"errors"
)

var ErrInvalid = errors.New("invalid cursor")

const maxCursorLength = 2048

func Encode(parts ...string) string {
	data, _ := json.Marshal(parts)
	return base64.RawURLEncoding.EncodeToString(data)
}

func Decode(value string, count int) ([]string, error) {
	if value == "" || len(value) > maxCursorLength || count < 1 {
		return nil, ErrInvalid
	}

	data, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, ErrInvalid
	}

	var parts []string
	if err := json.Unmarshal(data, &parts); err != nil || len(parts) != count {
		return nil, ErrInvalid
	}

	return parts, nil
}
