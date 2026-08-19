package httpapi

import (
	"errors"
	"net/http"
	"strconv"
)

func nodeListLimit(r *http.Request) (int, error) {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return 50, nil
	}

	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 100 {
		return 0, errors.New("invalid limit")
	}
	return limit, nil
}
