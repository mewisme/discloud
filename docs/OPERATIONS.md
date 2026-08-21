# DisCloud Operations

This document covers production health checks, diagnostics, observability,
PostgreSQL backup/restore, quota reconciliation, jobs, and technical orphan
cleanup.

## Health

### Liveness

```http
GET /healthz
```

Expected healthy response:

```text
204 No Content
```

Liveness only means the DisCloud process is alive and able to serve HTTP.

### Readiness

```http
GET /readyz
```

Expected healthy response:

```text
204 No Content
```

Readiness requires:

- PostgreSQL to be reachable;
- database migrations to have completed before HTTP startup;
- Discord storage to be initialized;
- at least one configured Discord bot to be usable.

A failed readiness check returns:

```text
503 Service Unavailable
```

Do not use `/healthz` as a readiness probe.

## Structured logging

DisCloud uses structured `slog` logging.

HTTP completion logs include:

```text
request_id
trace_id
span_id
method
route
status
duration_ms
response_bytes
```

The HTTP access middleware records the registered route pattern instead of the
raw URL path.

For example:

```text
/api/v1/files/{fileId}/content
```

instead of:

```text
/api/v1/files/019.../content
```

This avoids using file IDs, public share IDs, or other resource identifiers as
normal access-log dimensions.

Never log:

- passwords;
- session secrets;
- TOTP secrets;
- recovery-code plaintext;
- Discord bot tokens;
- encryption master keys.

## Tracing

DisCloud supports W3C `traceparent` propagation.

Example incoming header:

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

When valid:

- the incoming trace ID is continued;
- DisCloud creates a new server span ID;
- trace flags are propagated;
- the response contains a new `traceparent`.

Malformed trace context is ignored and replaced with a new trace.

This provides a stable W3C-compatible propagation boundary without requiring a
particular tracing backend.

An OpenTelemetry SDK/exporter may be attached later without changing the HTTP
contract.

## Metrics

Prometheus-compatible metrics are available to authenticated administrators:

```http
GET /api/v1/admin/metrics
```

The endpoint returns:

```text
Content-Type: text/plain; version=0.0.4; charset=utf-8
```

Current metrics include:

```text
discloud_uptime_seconds
discloud_http_requests_in_flight
discloud_http_requests_total
discloud_http_request_duration_seconds
discloud_postgres_pool_connections
discloud_postgres_pool_max_connections
discloud_jobs_current
discloud_upload_sessions_current
discloud_chunks_current
discloud_chunk_bytes_current
```

Metrics intentionally use bounded labels such as:

```text
method
route
status
job status
upload status
chunk status
```

Do not introduce labels containing:

```text
user ID
username
file ID
folder ID
filename
collection ID
public share ID
upload ID
job ID
Discord message ID
```

These values create unbounded metric cardinality.

If a dedicated Prometheus installation is added later, prefer a dedicated
authenticated scrape mechanism instead of making operational metrics public.

## Discord bot runtime

Discord storage concurrency is derived from the current usable bot pool.

There are no independent upload/download concurrency configuration values.

Runtime state is available to administrators:

```http
GET /api/v1/admin/bots
```

Important summary fields include:

```text
configured
effectiveCapacity
availableNow
working
idle
cooldown
activeLeases
totalWaiting
```

The distinction is important:

```text
configured
= resolved bots known to the process

effectiveCapacity
= bots currently eligible to perform normal Discord work

availableNow
= effective bots that are not currently holding a lease
```

A busy bot remains part of effective capacity.

A bot in any of these states is excluded from effective capacity:

```text
cooldown
draining
disabled
unhealthy
```

The scheduler enforces:

```text
one bot <= one Discord operation lease at a time
```

Normal leased operations include:

```text
upload
resolve
delete
maintenance
```

When multiple operation classes are queued, the scheduler rotates between
assignable classes instead of permanently reserving bots for one type of work.

If only one class has work, that class may consume the full usable bot pool.

### Realtime bot events

Administrators may subscribe using Server-Sent Events:

```http
GET /api/v1/admin/bots/events
```

The stream includes process-local events such as:

```text
bot.lease.started
bot.lease.finished
bot.cooldown.started
bot.cooldown.finished
bot.state.changed
bot.identity.updated
scheduler.queue.changed
operation.succeeded
operation.failed
```

SSE clients may reconnect with `Last-Event-ID`.

If the requested event is older than the in-memory replay window, the server
emits a reset event and the client must reload the current snapshot.

Runtime events are not an audit log and are not persisted to PostgreSQL.

### Runtime bot controls

Administrator controls include:

```http
POST /api/v1/admin/bots/{botId}/probe
POST /api/v1/admin/bots/{botId}/drain
POST /api/v1/admin/bots/{botId}/disable
POST /api/v1/admin/bots/{botId}/enable
```

`probe` calls Discord `/users/@me`, refreshes cached bot identity, and updates
runtime health.

`drain` prevents new leases while allowing the current lease to finish. The bot
then becomes disabled.

Disabling a currently working bot also drains it instead of cancelling an
in-flight Discord request.

Runtime controls are intentionally ephemeral:

```text
process restart
→ configured bots resolve again
→ runtime disabled/draining state is reset
```

Persistent bot membership remains deployment configuration through
`DISCLOUD_DISCORD_BOT_TOKENS`.

Bot tokens must never be returned by these endpoints or written to logs.

### Adaptive upload concurrency

Upload-session responses contain:

```text
recommendedPartConcurrency
```

The value is derived from effective Discord capacity.

The browser uses the recommendation as an advisory part-upload gate.

It is not an authorization or concurrency guarantee:

```text
browser gate
→ reduces unnecessary outstanding requests

backend scheduler
→ remains the global concurrency authority
```

When the recommendation decreases, already running browser part uploads are
allowed to complete. New work waits until concurrency falls below the new
limit.

### Adaptive upload chunk sizing

`DISCLOUD_UPLOAD_CHUNK_SIZE` is the default and upper chunk target.

At upload-session creation DisCloud may choose a smaller chunk size when the
default number of parts is insufficient to use available bot capacity.

The current policy targets approximately:

```text
effective capacity * 2 parts
```

and currently uses a minimum adaptive chunk candidate of:

```text
2 MiB
```

The selected values are persisted in the upload session:

```text
chunk_size_bytes
expected_parts
```

They never change for that session, even if bot capacity changes later.

This guarantees stable resume semantics.

Large files that already contain enough default-sized parts keep the configured
default chunk size instead of being divided unnecessarily.

See [BENCHMARKING.md](BENCHMARKING.md) before changing the adaptive floor or
scheduler policy.

## Admin diagnostics

### Storage overview

```http
GET /api/v1/admin/storage
```

Important fields include:

```text
activeFileCount
derivedLogicalUsedBytes
cachedLogicalUsedBytes
derivedReservedBytes
cachedReservedBytes
quotaMismatchUsers
uniqueChunkCount
uniqueChunkBytes
readyChunkCount
readyChunkBytes
uncommittedChunkCount
uncommittedChunkBytes
orphanCandidateChunkCount
orphanCandidateChunkBytes
```

Logical usage and physical storage are intentionally different.

### Failed jobs

```http
GET /api/v1/admin/jobs?status=failed
```

### Dead jobs

```http
GET /api/v1/admin/jobs?status=dead
```

Filter by job type when needed:

```http
GET /api/v1/admin/jobs?status=dead&type=file.metadata
```

### Failed uploads

```http
GET /api/v1/admin/uploads?status=failed
```

Upload diagnostics include:

```text
attempt count
failed attempt count
last error class
last error message
```

### Audit events

```http
GET /api/v1/admin/audit
```

Example filters:

```http
GET /api/v1/admin/audit?action=storage.quota_reconcile
```

```http
GET /api/v1/admin/audit?actorUserId=019...
```

Audit events are append-only from the application perspective.

## Job leases

A worker changes a job:

```text
queued
→ running
```

and periodically refreshes its lease.

Normal completion:

```text
queued
→ running
→ completed
```

Retryable failure:

```text
running
→ queued
→ running
→ ...
```

When `max_attempts` is reached:

```text
running
→ dead
```

A permanent job error becomes:

```text
running
→ failed
```

If a worker process disappears while executing a job:

```text
running
→ lease expires
→ queued
```

If the expired lease belongs to the final allowed attempt:

```text
running
→ lease expires
→ dead
```

Do not manually change `running` jobs to `queued` unless the automated lease
recovery mechanism is itself unavailable and the incident has been diagnosed.

## Quota model

User quota is logical and owner-based.

Cached counters:

```text
users.storage_used_bytes
users.storage_reserved_bytes
```

Derived used storage is:

```text
sum(size of effectively active owned files)
```

Derived reserved storage is:

```text
sum(reserved_bytes of open/completing upload sessions)
```

Chunk deduplication does not reduce logical quota.

Deleting a file or folder to trash releases logical quota immediately.

Restoring data consumes quota again.

## Quota reconciliation

Inspect before mutating:

```http
GET /api/v1/admin/storage
```

If:

```text
quotaMismatchUsers > 0
```

reconcile one user first when practical.

### One user

```http
POST /api/v1/admin/storage/reconcile
Content-Type: application/json
```

```json
{
  "userId": "019..."
}
```

### All users

```http
POST /api/v1/admin/storage/reconcile
Content-Type: application/json
```

```json
{}
```

Reconciliation:

1. locks affected user quota rows;
2. derives active logical file bytes;
3. derives active upload reservation bytes;
4. updates cached counters;
5. records an audit event.

Reconciliation does not modify chunks or Discord attachments.

## Chunk lifecycle

Chunks have two relevant storage states:

```text
uncommitted
ready
```

A `ready` chunk belongs to committed data.

A committed chunk is never garbage-collected by normal DisCloud product
lifecycle.

This remains true when the owning file is:

```text
active
trashed
restored
```

There is no permanent-delete product API in V1.

## Technical orphan cleanup

Technical GC is allowed only for abandoned, never-committed data.

A chunk is eligible only when all of the following are true:

```text
status = uncommitted
older than the technical grace period
not referenced by file_chunks
not referenced by an open upload
not referenced by a completing upload
```

Closed upload references may be removed as part of cleanup.

Cleanup then:

1. acquires the chunk digest advisory lock;
2. rechecks eligibility;
3. deletes the Discord message;
4. removes closed upload-part references;
5. deletes the chunk row.

The digest advisory lock serializes cleanup with concurrent dedupe/upload.

Never change orphan cleanup to include `ready` chunks without a deliberate
product/storage migration.

### Known orphan boundary

If a process successfully uploads a Discord message and dies before registering
the chunk locator in PostgreSQL, the database has no information identifying
that Discord message.

The normal database-driven orphan sweeper therefore cannot discover that
message.

Scanning the Discord channel for unregistered messages is a separate
maintenance capability and is intentionally outside normal V1 GC.

## Discord storage recovery assumptions

PostgreSQL stores canonical Discord locators:

```text
channel ID
message ID
attachment ID
SHA-256
size
```

PostgreSQL does not contain the actual Discord attachment bytes.

Therefore:

```text
PostgreSQL backup != complete physical blob backup
```

A database restore remains usable only if the referenced Discord messages and
attachments still exist.

Do not delete or recreate the configured storage channel during database
recovery.

## PostgreSQL backup scope

PostgreSQL is canonical for:

- users;
- password hashes;
- sessions;
- MFA state;
- encrypted TOTP secrets;
- recovery-code hashes;
- nodes;
- file metadata;
- chunk locators;
- file-to-chunk mappings;
- upload sessions;
- quotas;
- folder ACLs;
- collections;
- collection ACLs;
- public shares;
- jobs;
- audit events.

Discord attachment bytes are outside the PostgreSQL backup.

## Required secret backup

Back up deployment secrets separately from the database archive.

At minimum:

```text
DISCLOUD_ENCRYPTION_MASTER_KEY_BASE64
DISCLOUD_DISCORD_BOT_TOKENS
DISCLOUD_DISCORD_GUILD_ID
DISCLOUD_DISCORD_CHANNEL_ID
database credentials
TLS/reverse-proxy credentials where applicable
```

The original encryption master key is required to decrypt stored TOTP secrets.

A database backup without the matching encryption master key is not a complete
authentication recovery backup.

## PostgreSQL version

Production DisCloud targets PostgreSQL 18.

Use PostgreSQL 18 or newer compatible PostgreSQL client tools to create and
inspect backups.

Migrations are forward-only.

Do not start an older DisCloud binary against a database already migrated by a
newer incompatible application version.

## Online database backup

`pg_dump` creates a transactionally consistent logical snapshot and may be run
while the service is online.

For routine backups use custom format.

### PowerShell

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$directory = "backups"
$dump = Join-Path $directory "discloud-$stamp.dump"

New-Item -ItemType Directory -Force $directory | Out-Null

pg_dump `
  --dbname="$env:DISCLOUD_DATABASE_DSN" `
  --format=custom `
  --no-owner `
  --no-privileges `
  --file="$dump"

if ($LASTEXITCODE -ne 0) {
    throw "pg_dump failed"
}

Get-FileHash -Algorithm SHA256 $dump

pg_restore --list "$dump" | Select-Object -First 30
```

Store the SHA-256 digest with the backup metadata.

A successful `pg_dump` command alone does not prove recoverability.

Restore rehearsal is required.

## Final cutover backup

For a migration or disaster-recovery cutover where no writes after the dump may
be lost:

1. stop all DisCloud application instances;
2. verify no worker is writing to PostgreSQL;
3. take the final `pg_dump`;
4. retain the original database until the restored environment is verified.

## Backup storage

Keep database backups outside the application host.

Recommended properties:

- encrypted at rest;
- separately access controlled;
- multiple historical restore points;
- at least one copy outside the primary failure domain;
- backup integrity hashes retained with metadata.

Application logs are not backups.

Discord attachments are not PostgreSQL backups.

## Restore procedure

Always restore into a separate empty database first.

### 1. Create restore database

Create an empty PostgreSQL 18 database and ensure the DisCloud database account
can use the required extensions.

### 2. Set the restore DSN

```powershell
$env:DISCLOUD_RESTORE_DSN="postgres://discloud:password@localhost:5432/discloud_restore?sslmode=disable"
$dump="backups/discloud-20260819-170000.dump"
```

### 3. Inspect the archive

```powershell
pg_restore --list "$dump"
```

### 4. Restore

```powershell
pg_restore `
  --dbname="$env:DISCLOUD_RESTORE_DSN" `
  --no-owner `
  --no-privileges `
  --exit-on-error `
  "$dump"

if ($LASTEXITCODE -ne 0) {
    throw "pg_restore failed"
}
```

Prefer restoring into an empty database rather than using `--clean` against a
live production database.

### 5. Restore deployment secrets

Restore the original:

```text
encryption master key
Discord bot tokens
Discord guild ID
Discord channel ID
database/application configuration
```

### 6. Point DisCloud at the restored database

Set:

```text
DISCLOUD_DATABASE_DSN
```

to the restored database.

Start the same release or a forward-compatible newer release.

Startup migrations should either be a no-op or apply newer forward migrations.

### 7. Verify readiness

```powershell
Invoke-WebRequest `
  -Uri "http://localhost:8080/readyz" `
  -Method Get
```

Expected status:

```text
204
```

### 8. Verify authentication

Test:

- administrator login;
- normal-user login;
- MFA login if enabled;
- one recovery-code flow in a dedicated restore rehearsal environment.

Do not consume a production recovery code merely for routine monitoring.

### 9. Verify logical data

Check:

- root folder;
- nested folders;
- ACL-visible folders;
- collections;
- trash;
- public shares;
- quota/storage overview.

### 10. Verify file reconstruction

Test representative files containing:

```text
one chunk
multiple chunks
deduplicated chunks
old committed chunks
restored files
```

Test:

```http
GET /api/v1/files/{fileId}/content
```

and a ranged request:

```http
Range: bytes=100-999
```

Verify:

```text
206 Partial Content
Content-Range
correct byte content
```

### 11. Verify folder archive

Download a nested folder archive and verify:

- hierarchy;
- names;
- file contents;
- no missing committed chunks.

### 12. Verify public sharing

Test representative:

```text
file share
folder share
collection share
revoked share
```

Deleted/revoked resources must remain inaccessible.

## Post-restore quota check

Call:

```http
GET /api/v1/admin/storage
```

Inspect:

```text
derivedLogicalUsedBytes
cachedLogicalUsedBytes
derivedReservedBytes
cachedReservedBytes
quotaMismatchUsers
```

Only run quota reconciliation if a mismatch exists.

## Post-restore jobs

Inspect:

```http
GET /api/v1/admin/jobs?status=failed
```

```http
GET /api/v1/admin/jobs?status=dead
```

```http
GET /api/v1/admin/uploads?status=failed
```

A job restored in `running` state will eventually be recovered when its worker
lease becomes stale.

## Restore rehearsal

Run restore rehearsals regularly.

A rehearsal should prove:

```text
backup archive can be read
database restores successfully
application starts
readiness succeeds
admin authentication works
MFA secrets decrypt
folder ACLs work
quota diagnostics are sane
Discord-backed downloads work
Range reads work
folder ZIP works
public shares work
```

A backup that has never been restored should be considered unverified.