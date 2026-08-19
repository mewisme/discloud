# DisCloud Backend V1 Release Checklist

This checklist freezes the backend before web-client implementation begins.

A checked item means the command or procedure was actually executed against
the release candidate. Do not check an item merely because the implementation
exists.

## Release identity

Record:

```text
Commit:
Date:
Go version:
PostgreSQL version:
Operating system:
CPU:
RAM:
DISCLOUD release/environment:
```

## 1. Clean build

```powershell
go fmt ./...
git diff --exit-code

go vet ./...
go test ./...
```

Required:

- no formatting diff;
- vet passes;
- unit tests pass.

## 2. Race suite

Configure the isolated PostgreSQL test database:

```powershell
$env:DISCLOUD_TEST_DATABASE_DSN="postgres://discloud:discloud@localhost:5432/discloud?sslmode=disable"
```

Run:

```powershell
go test -race ./...
```

Required:

- no race detector findings;
- no integration failures;
- no leaked goroutine/resource symptoms.

## 3. High-risk concurrency

```powershell
go test -race -count=20 -run Concurrent ./internal/setup/...
go test -race -count=20 -run Concurrent ./internal/nodes/...
go test -race -count=20 -run Concurrent ./internal/uploads/...
```

Confirm:

```text
[ ] only one first setup wins
[ ] same-name concurrent create has one winner
[ ] quota reservations cannot over-reserve
[ ] same-digest uploads produce one canonical chunk
[ ] move/trash cannot resurrect a node
[ ] restore/conflicting-create has one active winner
[ ] duplicate finalize creates one logical file
```

## 4. OpenAPI contract

```powershell
go test -run OpenAPI -count=1 -v ./internal/httpapi
```

Confirm:

```text
[ ] every registered route exists in OpenAPI
[ ] no extra stale route exists in OpenAPI
[ ] operationId values are unique
[ ] public/authenticated route security matches router behavior
[ ] external references resolve
[ ] error matrix covers all operationIds
[ ] examples use documented success/error statuses
```

## 5. Migration review

```powershell
go test ./migrations/...
```

Confirm:

```text
[ ] migration sequence has no gap
[ ] migration numbers are unique
[ ] migrations are forward-only
[ ] destructive DDL is explicitly reviewed
[ ] empty PostgreSQL database migrates successfully
```

Never modify a migration already used by a deployed environment.

Add a new forward migration instead.

## 6. Fuzz seed suite

Normal test execution must run all seed corpora:

```powershell
go test ./internal/files/...
go test ./internal/folders/...
go test ./internal/nodes/...
go test ./internal/cursor/...
```

## 7. Extended fuzz run

Before a release candidate:

```powershell
go test -fuzz=FuzzParseRange -fuzztime=5m ./internal/files
go test -fuzz=FuzzCanonicalMIME -fuzztime=5m ./internal/files
go test -fuzz=FuzzNormalizeMIME -fuzztime=5m ./internal/files
go test -fuzz=FuzzSanitizeArchiveSegment -fuzztime=5m ./internal/folders
go test -fuzz=FuzzNormalizeName -fuzztime=5m ./internal/nodes
go test -fuzz=FuzzDecode -fuzztime=5m ./internal/cursor
```

Any input that causes a panic or invariant violation must become a retained
regression case.

## 8. Search plan

Run against a representative dataset:

```powershell
$env:DISCLOUD_SEARCH_PLAN="1"
$env:DISCLOUD_SEARCH_PLAN_N="10000"

go test `
  -run TestSearchPlanRepresentative `
  -count=1 `
  -v `
  ./internal/search
```

Record:

```text
Planning time:
Execution time:
Indexes used:
Sequential scans:
Dataset size:
```

Optionally enforce a known environment-specific ceiling:

```powershell
$env:DISCLOUD_SEARCH_PLAN_MAX_MS="250"
```

If the deployment baseline requires the trigram index:

```powershell
$env:DISCLOUD_SEARCH_PLAN_REQUIRE_TRGM="1"
```

Do not mark the search performance gate complete until the representative plan
has actually been inspected.

## 9. Search benchmark

```powershell
$env:DISCLOUD_SEARCH_BENCH_N="10000"

go test `
  -run '^$' `
  -bench BenchmarkSearchRepresentative `
  -benchtime=10s `
  ./internal/search
```

Record the result beside the release candidate.

Compare it with the previous accepted baseline when one exists.

## 10. Load suite

Enable the explicit load tests:

```powershell
$env:DISCLOUD_RUN_LOAD_TESTS="1"
```

Run:

```powershell
go test `
  -run '^TestLoad' `
  -count=1 `
  -v `
  ./internal/uploads/... `
  ./internal/nodes/... `
  ./internal/folders/...
```

The default workloads cover:

```text
many concurrent small file uploads
several concurrent large file uploads
Range-heavy reads crossing chunk boundaries
large folder listing
folder ZIP streaming
large trash tree
```

Permission-heavy search is covered separately by the representative search
benchmark.

Record:

```text
small upload files/s:
small upload MiB/s:

large upload files/s:
large upload MiB/s:

Range requests/s:
Range MiB/s:

large folder items/s:

ZIP MiB/s:

trash listing items/s:

search benchmark:
```

The load suite uses the fake BlobStore for deterministic backend testing.
It does not intentionally rate-limit or stress the real Discord API.

## 11. Optional load tuning

Examples:

```powershell
$env:DISCLOUD_LOAD_SMALL_FILES="128"
$env:DISCLOUD_LOAD_SMALL_CONCURRENCY="32"

$env:DISCLOUD_LOAD_LARGE_FILES="8"
$env:DISCLOUD_LOAD_LARGE_MIB="32"
$env:DISCLOUD_LOAD_LARGE_CONCURRENCY="4"

$env:DISCLOUD_LOAD_RANGE_READERS="32"
$env:DISCLOUD_LOAD_RANGE_READS="128"

$env:DISCLOUD_LOAD_FOLDER_CHILDREN="25000"

$env:DISCLOUD_LOAD_ZIP_FILES="10000"

$env:DISCLOUD_LOAD_TRASH_PARENTS="200"
$env:DISCLOUD_LOAD_TRASH_CHILDREN="100"
```

Increase workloads only on machines with enough memory and PostgreSQL capacity.

## 12. Discord storage smoke test

Using a non-production test channel or a deliberately selected production
smoke object:

```text
[ ] all configured bot tokens initialize
[ ] upload succeeds
[ ] retry with another bot succeeds after retryable failure
[ ] full download succeeds
[ ] cross-chunk Range download succeeds
[ ] deduplicated upload succeeds
[ ] committed chunk remains readable
```

Do not use the release process as an uncontrolled Discord load test.

## 13. Trash and restore

Verify:

```text
[ ] file trash releases logical quota
[ ] folder trash releases descendant logical quota
[ ] nested directly-deleted child remains deleted after parent restore
[ ] restore fails on name conflict
[ ] restore fails when quota is insufficient
[ ] restore does not reactivate revoked public shares
[ ] committed blob remains intact while trashed
```

## 14. ACL matrix

Verify normal-user behavior for:

```text
owner
view
edit
full
no access
collection-only access
administrator
```

Across:

```text
node detail
folder listing
rename
move
upload
download
folder ZIP
search
collection membership
trash
restore
share create
```

No endpoint may reveal inaccessible structural information simply because the
caller knows a UUID.

## 15. Public shares

Verify:

```text
[ ] file share resolves anonymously
[ ] folder share cannot escape shared subtree
[ ] collection share cannot reveal parent folders
[ ] revoked share fails immediately
[ ] trashed resource fails immediately
[ ] restore does not reactivate old share
[ ] no Discord/CDN locator is exposed
```

## 16. Authentication

Verify:

```text
[ ] first setup remains atomic
[ ] invalid login does not create session
[ ] disabled user cannot authenticate
[ ] logout revokes server-side session
[ ] session cookie is HttpOnly
[ ] HTTPS cookie is Secure
[ ] SameSite=None requires Secure
[ ] password change follows session-revocation policy
```

For MFA:

```text
[ ] password alone cannot create full session
[ ] TOTP succeeds
[ ] invalid TOTP fails
[ ] recovery code is one-time
[ ] TOTP secret is encrypted at rest
[ ] plaintext recovery codes are not retained
```

## 17. CSRF and headers

```powershell
go test -race ./internal/httpapi/...
```

Verify:

```text
[ ] cross-origin unsafe request blocked
[ ] same-site sibling unsafe request blocked
[ ] same-origin request allowed
[ ] non-browser authenticated API client remains supported
[ ] X-Content-Type-Options present
[ ] X-Frame-Options present
[ ] Referrer-Policy present
[ ] Permissions-Policy present
[ ] HSTS only enabled for HTTPS public URL
```

## 18. Operational diagnostics

As administrator, verify:

```text
GET /api/v1/admin/audit
GET /api/v1/admin/jobs
GET /api/v1/admin/uploads
GET /api/v1/admin/storage
GET /api/v1/admin/metrics
```

Confirm no operational endpoint exposes:

```text
Discord bot tokens
session tokens
passwords
TOTP secrets
encryption master key
database credentials
```

## 19. Quota reconciliation

Before release:

```text
[ ] admin storage overview reports zero unexpected mismatches
[ ] targeted reconciliation works
[ ] global reconciliation works
[ ] reconciliation is audited
```

Do not reconcile merely to hide an unexplained recurring mismatch.

Investigate the cause first.

## 20. Orphan cleanup

Verify with technical test data:

```text
[ ] old uncommitted unreferenced chunk is cleaned
[ ] closed-upload orphan is cleaned
[ ] open-upload chunk is protected
[ ] completing-upload chunk is protected
[ ] ready chunk is protected
[ ] Discord 404 during technical delete is idempotent
```

A committed chunk must never become a normal GC candidate.

## 21. Readiness

Verify:

```text
[ ] PostgreSQL unavailable => not ready
[ ] zero usable Discord bots => not ready
[ ] healthy PostgreSQL + initialized storage => ready
[ ] readiness does not make a live Discord API request every probe
```

## 22. Backup

Create an actual PostgreSQL custom-format backup.

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dump = "backups/discloud-$stamp.dump"

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
pg_restore --list "$dump"
```

Record:

```text
Backup filename:
SHA-256:
Database version:
Application commit:
```

## 23. Restore rehearsal

Restore the backup into a separate empty PostgreSQL database.

Verify:

```text
[ ] pg_restore succeeds
[ ] application starts
[ ] /readyz returns 204
[ ] administrator login works
[ ] MFA secret decrypts
[ ] root folders load
[ ] ACLs work
[ ] normal full download works
[ ] Range download works
[ ] folder ZIP works
[ ] collection access works
[ ] public share works
[ ] quota overview is sane
[ ] failed/dead job diagnostics work
```

A backup that has never been restored is unverified.

## 24. Documentation review

Confirm current:

```text
[ ] OpenAPI spec
[ ] error/status catalog
[ ] API examples
[ ] operations runbook
[ ] security model
[ ] release checklist
```

## 25. V1 freeze decision

Backend v1 may be frozen for web-client development only when:

```text
[ ] full race suite passes
[ ] high-risk concurrency suite passes
[ ] fuzz run has no unresolved findings
[ ] representative search plan accepted
[ ] load results recorded and accepted
[ ] migration review passes
[ ] threat-model review has no unresolved critical issue
[ ] PostgreSQL restore rehearsal succeeds
[ ] OpenAPI contract is frozen
[ ] no known data-loss bug remains
```

Do not call the backend release-ready solely because all feature phases have
implementation code.