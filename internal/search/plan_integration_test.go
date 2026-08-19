package search

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/migrations"
)

type searchQueryCapture struct {
	mu   sync.Mutex
	sql  string
	args []any
}

type explainReport struct {
	Plan          explainNode `json:"Plan"`
	PlanningTime  float64     `json:"Planning Time"`
	ExecutionTime float64     `json:"Execution Time"`
}

type explainNode struct {
	NodeType         string        `json:"Node Type"`
	RelationName     string        `json:"Relation Name"`
	IndexName        string        `json:"Index Name"`
	ActualRows       float64       `json:"Actual Rows"`
	ActualTotalTime  float64       `json:"Actual Total Time"`
	SharedHitBlocks  float64       `json:"Shared Hit Blocks"`
	SharedReadBlocks float64       `json:"Shared Read Blocks"`
	Plans            []explainNode `json:"Plans"`
}

func (c *searchQueryCapture) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.Contains(data.SQL, "access_summary AS") {
		c.mu.Lock()
		c.sql = data.SQL
		c.args = append([]any(nil), data.Args...)
		c.mu.Unlock()
	}
	return ctx
}

func (*searchQueryCapture) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func (c *searchQueryCapture) reset() {
	c.mu.Lock()
	c.sql = ""
	c.args = nil
	c.mu.Unlock()
}

func (c *searchQueryCapture) snapshot() (string, []any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.sql, append([]any(nil), c.args...)
}

func TestSearchPlanRepresentative(t *testing.T) {
	if os.Getenv("DISCLOUD_SEARCH_PLAN") != "1" {
		t.Skip("set DISCLOUD_SEARCH_PLAN=1 to run representative EXPLAIN ANALYZE")
	}

	capture := &searchQueryCapture{}
	ctx, pool := openSearchPerformancePool(t, capture)
	perUser := searchPerformanceNodeCount("DISCLOUD_SEARCH_PLAN_N", 10000)
	userID := seedSearchPerformanceData(t, ctx, pool, perUser)

	if _, err := pool.Exec(ctx, "ANALYZE nodes; ANALYZE files"); err != nil {
		t.Fatalf("analyze search tables: %v", err)
	}

	capture.reset()

	page, err := New(pool).Search(ctx, Actor{UserID: userID}, Input{
		Query: "quarterly-report-2026",
		Kind:  "file",
		Limit: 20,
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(page.Items) == 0 {
		t.Fatal("representative search returned no results")
	}

	sql, args := capture.snapshot()
	if sql == "" {
		t.Fatal("search query was not captured")
	}

	var raw []byte
	if err := pool.QueryRow(
		ctx,
		"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+sql,
		args...,
	).Scan(&raw); err != nil {
		t.Fatalf("explain search query: %v", err)
	}

	var reports []explainReport
	if err := json.Unmarshal(raw, &reports); err != nil {
		t.Fatalf("decode EXPLAIN: %v", err)
	}
	if len(reports) != 1 {
		t.Fatalf("EXPLAIN reports = %d, want 1", len(reports))
	}

	report := reports[0]
	indexes := map[string]struct{}{}
	seqScans := map[string]struct{}{}
	collectPlanStats(report.Plan, indexes, seqScans)

	t.Logf(
		"nodes=%d planning=%.3fms execution=%.3fms rootRows=%.0f sharedHits=%.0f sharedReads=%.0f",
		perUser*2,
		report.PlanningTime,
		report.ExecutionTime,
		report.Plan.ActualRows,
		report.Plan.SharedHitBlocks,
		report.Plan.SharedReadBlocks,
	)
	t.Logf("indexes=%v", sortedKeys(indexes))
	t.Logf("sequentialScans=%v", sortedKeys(seqScans))

	if _, ok := indexes["nodes_name_trgm_idx"]; !ok {
		t.Log("nodes_name_trgm_idx was not selected; inspect the plan at the chosen dataset size before accepting Phase 14 performance")
	}

	if rawMax := os.Getenv("DISCLOUD_SEARCH_PLAN_MAX_MS"); rawMax != "" {
		maxMS, err := strconv.ParseFloat(rawMax, 64)
		if err != nil || maxMS <= 0 {
			t.Fatalf("invalid DISCLOUD_SEARCH_PLAN_MAX_MS %q", rawMax)
		}
		if report.ExecutionTime > maxMS {
			t.Fatalf("search execution %.3fms exceeds %.3fms ceiling", report.ExecutionTime, maxMS)
		}
	}

	if os.Getenv("DISCLOUD_SEARCH_PLAN_REQUIRE_TRGM") == "1" {
		if _, ok := indexes["nodes_name_trgm_idx"]; !ok {
			t.Fatal("representative search plan did not use nodes_name_trgm_idx")
		}
	}
}

func BenchmarkSearchRepresentative(b *testing.B) {
	ctx, pool := openSearchPerformancePool(b, nil)
	perUser := searchPerformanceNodeCount("DISCLOUD_SEARCH_BENCH_N", 10000)
	userID := seedSearchPerformanceData(b, ctx, pool, perUser)
	service := New(pool)
	input := Input{
		Query: "quarterly-report-2026",
		Kind:  "file",
		Limit: 20,
	}

	if _, err := pool.Exec(ctx, "ANALYZE nodes; ANALYZE files"); err != nil {
		b.Fatalf("analyze search tables: %v", err)
	}
	if _, err := service.Search(ctx, Actor{UserID: userID}, input); err != nil {
		b.Fatalf("warm search: %v", err)
	}

	b.ReportMetric(float64(perUser*2), "nodes")
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		page, err := service.Search(ctx, Actor{UserID: userID}, input)
		if err != nil {
			b.Fatalf("search: %v", err)
		}
		if len(page.Items) == 0 {
			b.Fatal("search returned no results")
		}
	}
}

func openSearchPerformancePool(tb testing.TB, tracer pgx.QueryTracer) (context.Context, *pgxpool.Pool) {
	tb.Helper()

	dsn := os.Getenv("DISCLOUD_TEST_DATABASE_DSN")
	if dsn == "" {
		tb.Skip("DISCLOUD_TEST_DATABASE_DSN is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		cancel()
		tb.Fatalf("open admin pool: %v", err)
	}

	schema := fmt.Sprintf("discloud_search_perf_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		admin.Close()
		cancel()
		tb.Fatalf("create schema: %v", err)
	}

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		tb.Fatalf("parse DSN: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	if tracer != nil {
		cfg.ConnConfig.Tracer = tracer
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		tb.Fatalf("open isolated pool: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := migrate.Up(ctx, pool, migrations.FS, logger); err != nil {
		tb.Fatalf("migrate: %v", err)
	}

	tb.Cleanup(func() {
		pool.Close()
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		_, _ = admin.Exec(cleanupCtx, "DROP SCHEMA "+identifier+" CASCADE")
		admin.Close()
		cancel()
	})

	return ctx, pool
}

func seedSearchPerformanceData(tb testing.TB, ctx context.Context, pool *pgxpool.Pool, perUser int) string {
	tb.Helper()

	userID, rootID := createSearchPerformanceUser(tb, ctx, pool, "search-perf-owner")
	_, otherRootID := createSearchPerformanceUser(tb, ctx, pool, "search-perf-other")

	insertSearchPerformanceFiles(tb, ctx, pool, userID, rootID, perUser, true)

	var otherUserID string
	if err := pool.QueryRow(ctx, `
		SELECT owner_user_id::text
		FROM nodes
		WHERE id = $1::uuid
	`, otherRootID).Scan(&otherUserID); err != nil {
		tb.Fatalf("resolve other user: %v", err)
	}
	insertSearchPerformanceFiles(tb, ctx, pool, otherUserID, otherRootID, perUser, false)

	return userID
}

func createSearchPerformanceUser(tb testing.TB, ctx context.Context, pool *pgxpool.Pool, username string) (string, string) {
	tb.Helper()

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, 'test-hash', 'user')
		RETURNING id::text
	`, username).Scan(&userID); err != nil {
		tb.Fatalf("create user %s: %v", username, err)
	}

	var rootID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO nodes (
			kind, owner_user_id, name, name_key, is_root, created_by
		)
		VALUES ('folder', $1::uuid, '', '', true, $1::uuid)
		RETURNING id::text
	`, userID).Scan(&rootID); err != nil {
		tb.Fatalf("create root: %v", err)
	}

	return userID, rootID
}

func insertSearchPerformanceFiles(tb testing.TB, ctx context.Context, pool *pgxpool.Pool, userID, rootID string, count int, target bool) {
	tb.Helper()

	if count < 1 {
		tb.Fatalf("invalid search performance node count %d", count)
	}

	_, err := pool.Exec(ctx, `
		WITH inserted AS (
			INSERT INTO nodes (
				kind,
				owner_user_id,
				parent_id,
				name,
				name_key,
				created_by
			)
			SELECT
				'file',
				$1::uuid,
				$2::uuid,
				CASE
					WHEN $4 AND g = $3
						THEN 'quarterly-report-2026.pdf'
					ELSE 'document-' || lpad(g::text, 8, '0') || '.bin'
				END,
				CASE
					WHEN $4 AND g = $3
						THEN 'quarterly-report-2026.pdf'
					ELSE 'document-' || lpad(g::text, 8, '0') || '.bin'
				END,
				$1::uuid
			FROM generate_series(1, $3) AS g
			RETURNING id
		)
		INSERT INTO files (
			node_id,
			size_bytes,
			chunk_size_bytes,
			mime_type,
			category
		)
		SELECT
			id,
			1024,
			10485760,
			'application/octet-stream',
			'binary'
		FROM inserted
	`, userID, rootID, count, target)
	if err != nil {
		tb.Fatalf("seed %d files: %v", count, err)
	}
}

func searchPerformanceNodeCount(name string, fallback int) int {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return fallback
	}
	return value
}

func collectPlanStats(node explainNode, indexes, seqScans map[string]struct{}) {
	if node.IndexName != "" {
		indexes[node.IndexName] = struct{}{}
	}
	if node.NodeType == "Seq Scan" && node.RelationName != "" {
		seqScans[node.RelationName] = struct{}{}
	}
	for _, child := range node.Plans {
		collectPlanStats(child, indexes, seqScans)
	}
}

func sortedKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}
