package httpapi

import (
	"bytes"
	"net/http"

	"github.com/mewisme/discloud/internal/observability"
)

func metricsHandler(metrics *observability.Metrics) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var output bytes.Buffer
		if err := metrics.WritePrometheus(r.Context(), &output); err != nil {
			http.Error(
				w,
				"metrics unavailable",
				http.StatusServiceUnavailable,
			)
			return
		}

		w.Header().Set(
			"Content-Type",
			"text/plain; version=0.0.4; charset=utf-8",
		)
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(output.Bytes())
	})
}
