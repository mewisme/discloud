# DisCloud Storage Benchmarking

This document defines the repeatable benchmark procedure for Discord bot
capacity, scheduler fairness, adaptive browser concurrency, and adaptive upload
chunk sizing.

Benchmark results are environment-specific. Do not copy throughput or rate-limit
numbers from another deployment and treat them as production limits.

## Goals

The benchmark should answer:

1. How throughput changes with 1, 2, 4, 8, and 16 usable Discord bots.
2. Whether adaptive chunk sizing improves small and medium file completion.
3. Whether adaptive chunk sizing harms large-file throughput.
4. Whether smaller chunks create excessive browser hashing, HTTP, PostgreSQL,
   or temporary-disk overhead.
5. Whether scheduler fairness prevents resolve/delete starvation during upload
   pressure.
6. Whether increased bot concurrency materially increases Discord rate limits.

## Production invariants

The benchmark must not change these invariants:

```text
one Discord bot <= one active Discord lease
backend scheduler = global concurrency authority
browser concurrency = advisory only
chunk size is immutable after upload-session creation
resume uses the persisted session chunk size
bot tokens never leave the backend
```

## Deterministic Go benchmarks

Run the planner matrix:

```powershell
go test `
  -run '^$' `
  -bench BenchmarkChunkPlannerMatrix `
  -benchmem `
  ./internal/uploads
```

The output includes custom metrics:

```text
MiB/chunk
parts/file
```

Run scheduler benchmarks:

```powershell
go test `
  -run '^$' `
  -bench 'BenchmarkScheduler' `
  -benchmem `
  ./internal/discordstore
```

For a more stable local comparison:

```powershell
go test `
  -run '^$' `
  -bench 'BenchmarkScheduler|BenchmarkChunkPlannerMatrix' `
  -benchmem `
  -count=5 `
  ./internal/discordstore `
  ./internal/uploads
```

These benchmarks measure local planner and scheduler overhead. They do not
measure Discord network throughput or rate limiting.

## Correctness stress before performance tests

Run:

```powershell
go test ./internal/discordstore -count=100
go test -race ./internal/discordstore
go test -race ./internal/uploads
```

Performance results are not useful if scheduler or upload correctness is
unstable.

## Real Discord benchmark environment

Use:

- a dedicated benchmark PostgreSQL database;
- a dedicated Discord storage channel where practical;
- benchmark-only files;
- the same machine, network, reverse proxy, and application build for every
  comparison;
- the same browser version for browser upload tests.

Do not run uncontrolled load tests against production storage.

Record:

```text
commit
Go version
Node/pnpm version
browser version
operating system
CPU
RAM
network connection
PostgreSQL version
Discord guild/channel
configured bot count
effective bot capacity
DISCLOUD_UPLOAD_CHUNK_SIZE
```

Never record bot tokens.

## Bot-count matrix

For normal self-hosted deployments, the documentation recommends starting with **4 usable bots**. This is an operational starting point, not a benchmark conclusion; use the matrix below to determine whether a smaller or larger pool is appropriate for the actual workload and Discord rate-limit behavior.

Run each relevant workload with:

```text
1 bot
2 bots
4 bots
8 bots
16 bots
```

Set the desired token subset through:

```text
DISCLOUD_DISCORD_BOT_TOKENS
```

Restart DisCloud between bot-count configurations so the resolved bot pool is
unambiguous.

Verify the pool before every run:

```http
GET /api/v1/admin/bots
```

Record:

```text
configured
effectiveCapacity
availableNow
cooldown
totalWaiting
```

Do not start a run when the intended bots are already cooling down.

## File workload matrix

Use at least these workloads:

### Small

```text
128 files x 4 MiB
```

Purpose:

- request overhead;
- browser hashing overhead;
- many upload-session operations;
- scheduling overhead.

### Adaptive-sensitive

```text
20 MiB single file
80 MiB single file
```

Purpose:

- compare default chunk planning with adaptive chunk planning;
- observe whether additional bots are actually fed useful work.

### Large

```text
1 GiB single file
```

Purpose:

- verify adaptive planning does not unnecessarily reduce chunk size;
- measure sustained throughput.

### Concurrent users/files

```text
4 concurrent uploads x 256 MiB
```

Purpose:

- global scheduler enforcement;
- fairness;
- browser gate interaction;
- temporary disk pressure.

Increase workload sizes only if the benchmark host has sufficient disk, memory,
PostgreSQL, and network capacity.

## Candidate adaptive floors

The current production candidate is:

```text
2 MiB
```

The planner benchmark also evaluates:

```text
1 MiB
2 MiB
4 MiB
```

The minimum adaptive chunk size is intentionally an implementation policy, not
a public upload-session contract.

Before changing the production default, compare candidate floors on a local
benchmark branch and rebuild the same commit with only the candidate floor
changed.

The relevant constant is:

```text
internal/uploads/chunk_planner.go
initialMinAdaptiveChunkSize
```

Do not merge a candidate-floor change merely because it creates more parts.

## Metrics to record

For every real-storage run record:

```text
total file bytes
wall-clock duration
MiB/s
time to first completed file
selected session chunk size
expected part count
recommendedPartConcurrency
configured bot count
effective bot capacity
peak working bots
peak scheduler queue depth
oldest observed scheduler wait
Discord 429 count
retry count
failed operations
browser request count
browser hashing CPU
backend CPU
backend memory
temporary disk peak
PostgreSQL write activity
finalize duration
```

Use the admin bot runtime page or:

```http
GET /api/v1/admin/bots
GET /api/v1/admin/bots/events
```

to observe:

```text
working bots
cooldowns
queue depth
current operations
rate-limit counters
per-bot operation failures
throughput
```

The runtime history is process-local and resets when DisCloud restarts.

## Fixed-vs-adaptive comparison

The deterministic planner benchmark contains a fixed 10 MiB baseline.

For real Discord A/B testing, compare:

```text
A: fixed chunk planning
B: adaptive chunk planning
```

Do this on a local benchmark branch. Keep every other application, database,
network, and bot-pool setting identical.

A fixed-planning build can temporarily construct the upload service without the
capacity provider:

```go
uploads.New(
    pool,
    cfg.Upload.ChunkSizeBytes,
    cfg.Upload.SessionTTL,
)
```

The normal adaptive production path uses:

```go
uploads.NewWithCapacityProvider(
    pool,
    cfg.Upload.ChunkSizeBytes,
    cfg.Upload.SessionTTL,
    blobStore,
)
```

Do not merge the fixed benchmark variant.

## Rate-limit interpretation

More bots reduce pressure on an individual bot, but do not guarantee that
Discord returns no HTTP 429 responses.

When a bot receives a rate limit:

```text
429
→ Retry-After
→ scheduler cooldown
→ effective capacity decreases temporarily
→ browser recommendation is updated on the next upload-session response
```

A candidate is not automatically better just because aggregate throughput is
higher if it causes materially more cooldown or retry behavior.

## Fairness validation

While a large upload backlog exists, trigger representative reads and deletes.

Expected behavior:

```text
upload-only demand
→ uploads may consume the full pool

upload + resolve + delete contention
→ operation classes rotate fairly

waiter cannot use currently free bot
→ another compatible waiter may use that bot
```

Watch:

```text
upload queue
resolve queue
delete queue
oldest wait
```

Resolve/delete latency should not grow without bound under sustained upload
pressure.

## Result table

Record one row per benchmark run.

```text
commit:
host:
date:

| Bots | Mode | Floor | Workload | Chunk | Parts | MiB/s | First complete | Peak queue | 429 | Temp peak | Notes |
|------|------|-------|----------|-------|-------|-------|----------------|------------|-----|-----------|-------|
| 1    |      |       |          |       |       |       |                |            |     |           |       |
| 2    |      |       |          |       |       |       |                |            |     |           |       |
| 4    |      |       |          |       |       |       |                |            |     |           |       |
| 8    |      |       |          |       |       |       |                |            |     |           |       |
| 16   |      |       |          |       |       |       |                |            |     |           |       |
```

Keep raw benchmark output with the result record.

## Choosing the adaptive floor

Prefer the candidate that:

1. preserves correctness;
2. does not create unacceptable Discord cooldown/retry behavior;
3. improves small/medium completion when extra bot capacity exists;
4. does not materially regress large-file throughput;
5. keeps browser hashing, HTTP request count, temporary disk, and PostgreSQL
   overhead acceptable;
6. remains stable with concurrent users.

There is no universal fastest floor. The final default should be based on
repeatable measurements from the intended deployment profile.

## After changing planner policy

Run:

```powershell
go test ./internal/uploads
go test ./internal/discordstore
go test ./...
go vet ./...
```

Then:

```powershell
cd web
pnpm api:types:check
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Changing the planner algorithm does not require an OpenAPI change as long as
the existing upload-session fields and their meanings remain unchanged.
