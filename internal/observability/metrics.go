package observability

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const httpDurationBucketCount = 11

var httpDurationBuckets = [httpDurationBucketCount]float64{
	0.005,
	0.01,
	0.025,
	0.05,
	0.1,
	0.25,
	0.5,
	1,
	2.5,
	5,
	10,
}

var jobStatuses = []string{
	"queued",
	"running",
	"completed",
	"failed",
	"dead",
}

var uploadStatuses = []string{
	"open",
	"completing",
	"completed",
	"cancelled",
	"expired",
	"failed",
}

var chunkStatuses = []string{
	"uncommitted",
	"ready",
}

type requestMetricKey struct {
	Method string
	Route  string
	Status int
}

type histogramKey struct {
	Method string
	Route  string
}

type histogram struct {
	Buckets [httpDurationBucketCount]uint64
	Count   uint64
	Sum     float64
}

type Metrics struct {
	pool      *pgxpool.Pool
	startedAt time.Time
	inFlight  atomic.Int64

	mu        sync.Mutex
	requests  map[requestMetricKey]uint64
	durations map[histogramKey]histogram
}

func NewMetrics(pool *pgxpool.Pool) *Metrics {
	return &Metrics{
		pool:      pool,
		startedAt: time.Now().UTC(),
		requests:  make(map[requestMetricKey]uint64),
		durations: make(map[histogramKey]histogram),
	}
}

func (m *Metrics) BeginHTTP() {
	if m != nil {
		m.inFlight.Add(1)
	}
}

func (m *Metrics) EndHTTP(method, route string, status int, duration time.Duration) {
	if m == nil {
		return
	}

	m.inFlight.Add(-1)

	method = strings.ToUpper(strings.TrimSpace(method))
	if method == "" {
		method = "UNKNOWN"
	}
	if route == "" {
		route = "unmatched"
	}
	if status == 0 {
		status = 200
	}

	seconds := duration.Seconds()
	requestKey := requestMetricKey{
		Method: method,
		Route:  route,
		Status: status,
	}
	durationKey := histogramKey{
		Method: method,
		Route:  route,
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	m.requests[requestKey]++

	histogram := m.durations[durationKey]
	histogram.Count++
	histogram.Sum += seconds

	for i, boundary := range httpDurationBuckets {
		if seconds <= boundary {
			histogram.Buckets[i]++
		}
	}

	m.durations[durationKey] = histogram
}

func (m *Metrics) WritePrometheus(ctx context.Context, dst io.Writer) error {
	if m == nil {
		return fmt.Errorf("metrics registry is unavailable")
	}

	jobCounts := make(map[string]int64)
	uploadCounts := make(map[string]int64)
	chunkCounts := make(map[string]int64)
	chunkBytes := make(map[string]int64)

	if m.pool != nil {
		var err error

		jobCounts, err = queryStatusCounts(ctx, m.pool, `
			SELECT status, count(*)::bigint
			FROM jobs
			GROUP BY status
		`)
		if err != nil {
			return fmt.Errorf("collect job metrics: %w", err)
		}

		uploadCounts, err = queryStatusCounts(ctx, m.pool, `
			SELECT status, count(*)::bigint
			FROM upload_sessions
			GROUP BY status
		`)
		if err != nil {
			return fmt.Errorf("collect upload metrics: %w", err)
		}

		chunkCounts, chunkBytes, err = queryChunkMetrics(ctx, m.pool)
		if err != nil {
			return fmt.Errorf("collect chunk metrics: %w", err)
		}
	}

	requests, durations := m.snapshot()

	var output bytes.Buffer

	fmt.Fprintln(&output, "# HELP discloud_uptime_seconds Process uptime in seconds.")
	fmt.Fprintln(&output, "# TYPE discloud_uptime_seconds gauge")
	fmt.Fprintf(
		&output,
		"discloud_uptime_seconds %s\n",
		formatFloat(time.Since(m.startedAt).Seconds()),
	)

	fmt.Fprintln(&output, "# HELP discloud_http_requests_in_flight HTTP requests currently being served.")
	fmt.Fprintln(&output, "# TYPE discloud_http_requests_in_flight gauge")
	fmt.Fprintf(
		&output,
		"discloud_http_requests_in_flight %d\n",
		m.inFlight.Load(),
	)

	writeHTTPRequestMetrics(&output, requests)
	writeHTTPDurationMetrics(&output, durations)

	if m.pool != nil {
		writePoolMetrics(&output, m.pool)
		writeStatusMetrics(
			&output,
			"discloud_jobs_current",
			"Current jobs grouped by state.",
			jobStatuses,
			jobCounts,
		)
		writeStatusMetrics(
			&output,
			"discloud_upload_sessions_current",
			"Current upload sessions grouped by state.",
			uploadStatuses,
			uploadCounts,
		)
		writeStatusMetrics(
			&output,
			"discloud_chunks_current",
			"Current stored chunks grouped by state.",
			chunkStatuses,
			chunkCounts,
		)
		writeStatusMetrics(
			&output,
			"discloud_chunk_bytes_current",
			"Current physical chunk bytes grouped by state.",
			chunkStatuses,
			chunkBytes,
		)
	}

	_, err := dst.Write(output.Bytes())
	return err
}

func (m *Metrics) snapshot() (
	map[requestMetricKey]uint64,
	map[histogramKey]histogram,
) {
	m.mu.Lock()
	defer m.mu.Unlock()

	requests := make(map[requestMetricKey]uint64, len(m.requests))
	for key, value := range m.requests {
		requests[key] = value
	}

	durations := make(map[histogramKey]histogram, len(m.durations))
	for key, value := range m.durations {
		durations[key] = value
	}

	return requests, durations
}

func queryStatusCounts(
	ctx context.Context,
	pool *pgxpool.Pool,
	query string,
) (map[string]int64, error) {
	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]int64)

	for rows.Next() {
		var status string
		var count int64

		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		result[status] = count
	}

	return result, rows.Err()
}

func queryChunkMetrics(
	ctx context.Context,
	pool *pgxpool.Pool,
) (map[string]int64, map[string]int64, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			status,
			count(*)::bigint,
			COALESCE(sum(size_bytes), 0)::bigint
		FROM chunks
		GROUP BY status
	`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	counts := make(map[string]int64)
	bytes := make(map[string]int64)

	for rows.Next() {
		var status string
		var count, size int64

		if err := rows.Scan(&status, &count, &size); err != nil {
			return nil, nil, err
		}

		counts[status] = count
		bytes[status] = size
	}

	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	return counts, bytes, nil
}

func writeHTTPRequestMetrics(
	output *bytes.Buffer,
	values map[requestMetricKey]uint64,
) {
	fmt.Fprintln(output, "# HELP discloud_http_requests_total Total HTTP requests.")
	fmt.Fprintln(output, "# TYPE discloud_http_requests_total counter")

	keys := make([]requestMetricKey, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}

	sort.Slice(keys, func(i, j int) bool {
		if keys[i].Method != keys[j].Method {
			return keys[i].Method < keys[j].Method
		}
		if keys[i].Route != keys[j].Route {
			return keys[i].Route < keys[j].Route
		}
		return keys[i].Status < keys[j].Status
	})

	for _, key := range keys {
		fmt.Fprintf(
			output,
			"discloud_http_requests_total{method=\"%s\",route=\"%s\",status=\"%d\"} %d\n",
			escapeLabel(key.Method),
			escapeLabel(key.Route),
			key.Status,
			values[key],
		)
	}
}

func writeHTTPDurationMetrics(
	output *bytes.Buffer,
	values map[histogramKey]histogram,
) {
	fmt.Fprintln(
		output,
		"# HELP discloud_http_request_duration_seconds HTTP request duration in seconds.",
	)
	fmt.Fprintln(
		output,
		"# TYPE discloud_http_request_duration_seconds histogram",
	)

	keys := make([]histogramKey, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}

	sort.Slice(keys, func(i, j int) bool {
		if keys[i].Method != keys[j].Method {
			return keys[i].Method < keys[j].Method
		}
		return keys[i].Route < keys[j].Route
	})

	for _, key := range keys {
		value := values[key]

		for i, boundary := range httpDurationBuckets {
			fmt.Fprintf(
				output,
				"discloud_http_request_duration_seconds_bucket{method=\"%s\",route=\"%s\",le=\"%s\"} %d\n",
				escapeLabel(key.Method),
				escapeLabel(key.Route),
				formatFloat(boundary),
				value.Buckets[i],
			)
		}

		fmt.Fprintf(
			output,
			"discloud_http_request_duration_seconds_bucket{method=\"%s\",route=\"%s\",le=\"+Inf\"} %d\n",
			escapeLabel(key.Method),
			escapeLabel(key.Route),
			value.Count,
		)
		fmt.Fprintf(
			output,
			"discloud_http_request_duration_seconds_sum{method=\"%s\",route=\"%s\"} %s\n",
			escapeLabel(key.Method),
			escapeLabel(key.Route),
			formatFloat(value.Sum),
		)
		fmt.Fprintf(
			output,
			"discloud_http_request_duration_seconds_count{method=\"%s\",route=\"%s\"} %d\n",
			escapeLabel(key.Method),
			escapeLabel(key.Route),
			value.Count,
		)
	}
}

func writePoolMetrics(output *bytes.Buffer, pool *pgxpool.Pool) {
	stats := pool.Stat()

	fmt.Fprintln(
		output,
		"# HELP discloud_postgres_pool_connections PostgreSQL pool connections by state.",
	)
	fmt.Fprintln(output, "# TYPE discloud_postgres_pool_connections gauge")
	fmt.Fprintf(
		output,
		"discloud_postgres_pool_connections{state=\"acquired\"} %d\n",
		stats.AcquiredConns(),
	)
	fmt.Fprintf(
		output,
		"discloud_postgres_pool_connections{state=\"idle\"} %d\n",
		stats.IdleConns(),
	)
	fmt.Fprintf(
		output,
		"discloud_postgres_pool_connections{state=\"total\"} %d\n",
		stats.TotalConns(),
	)

	fmt.Fprintln(
		output,
		"# HELP discloud_postgres_pool_max_connections Configured PostgreSQL pool maximum.",
	)
	fmt.Fprintln(output, "# TYPE discloud_postgres_pool_max_connections gauge")
	fmt.Fprintf(
		output,
		"discloud_postgres_pool_max_connections %d\n",
		stats.MaxConns(),
	)
}

func writeStatusMetrics(
	output *bytes.Buffer,
	name, help string,
	statuses []string,
	values map[string]int64,
) {
	fmt.Fprintf(output, "# HELP %s %s\n", name, help)
	fmt.Fprintf(output, "# TYPE %s gauge\n", name)

	for _, status := range statuses {
		fmt.Fprintf(
			output,
			"%s{status=\"%s\"} %d\n",
			name,
			escapeLabel(status),
			values[status],
		)
	}
}

func escapeLabel(value string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		"\n", `\n`,
		`"`, `\"`,
	)
	return replacer.Replace(value)
}

func formatFloat(value float64) string {
	return strconv.FormatFloat(value, 'g', -1, 64)
}
