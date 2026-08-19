package httpapi

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/mewisme/discloud/internal/observability"
)

type observedResponseWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func observabilityMiddleware(
	metrics *observability.Metrics,
	logger *slog.Logger,
	next http.Handler,
) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, trace, err := observability.StartTrace(
			r.Context(),
			r.Header.Get(observability.TraceparentHeader),
		)
		if err != nil {
			WriteProblem(
				w,
				r,
				http.StatusInternalServerError,
				"Internal Server Error",
				"could not create trace context",
			)
			return
		}

		request := r.WithContext(ctx)
		writer := &observedResponseWriter{ResponseWriter: w}

		writer.Header().Set(
			observability.TraceparentHeader,
			trace.Traceparent(),
		)

		recordMetrics := metrics != nil &&
			r.URL.Path != "/api/v1/admin/metrics"

		if recordMetrics {
			metrics.BeginHTTP()
		}

		started := time.Now()
		next.ServeHTTP(writer, request)
		duration := time.Since(started)

		route := routePattern(request)
		status := writer.status
		if status == 0 {
			status = http.StatusOK
		}

		if recordMetrics {
			metrics.EndHTTP(
				request.Method,
				route,
				status,
				duration,
			)
		}

		if isProbeRoute(route) {
			return
		}

		logger.InfoContext(
			request.Context(),
			"HTTP request completed",
			"request_id", RequestID(request.Context()),
			"trace_id", trace.TraceID,
			"span_id", trace.SpanID,
			"method", request.Method,
			"route", route,
			"status", status,
			"duration_ms", duration.Milliseconds(),
			"response_bytes", writer.bytes,
		)
	})
}

func (w *observedResponseWriter) WriteHeader(status int) {
	if status >= 100 && status < 200 {
		w.ResponseWriter.WriteHeader(status)
		return
	}
	if w.status != 0 {
		return
	}

	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *observedResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}

	count, err := w.ResponseWriter.Write(data)
	w.bytes += int64(count)
	return count, err
}

func (w *observedResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func routePattern(r *http.Request) string {
	pattern := strings.TrimSpace(r.Pattern)
	if pattern == "" {
		return "unmatched"
	}

	if separator := strings.IndexByte(pattern, ' '); separator >= 0 {
		pattern = strings.TrimSpace(pattern[separator+1:])
	}
	return pattern
}

func isProbeRoute(route string) bool {
	switch route {
	case "/healthz", "/readyz", "/api/v1/admin/metrics":
		return true
	default:
		return false
	}
}
