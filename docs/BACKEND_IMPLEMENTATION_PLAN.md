# DisCloud Backend Implementation Plan

> Rewritten implementation-aware source of truth.
>
> Snapshot: **2026-08-20**
>
> Repository: `mewisme/discloud` · branch `main`
>
> Formal roadmap: **18 phases, Phase 0 through Phase 17**.
>
> Current backend posture: **feature implementation is complete through Phase 17 and the backend is treated as frozen for web-client development, but final release-verification evidence is not fully recorded**.

## 1. Purpose of this rewrite

The original backend plan was written as a from-scratch implementation roadmap. The repository has since implemented the full formal roadmap, then continued receiving backend extensions required by the web client. This document rewrites the plan to reflect the code that exists now.

It deliberately separates four different concepts:

- **formal phase implementation** — whether the code/harness described by the original phase exists;
- **verification evidence** — whether representative race/fuzz/load/restore results were actually recorded and accepted;
- **post-roadmap evolution** — backend features added while implementing the web client;
- **known carry-overs/bugs** — issues still observable in the current source and therefore not hidden by a blanket `DONE` label.

## 2. Status legend

- ✅ **IMPLEMENTED** — formal phase code/contract exists.
- ⚠️ **IMPLEMENTED, VERIFICATION PENDING** — implementation/harness exists, but an explicit acceptance result is still missing.
- 🧭 **POST-ROADMAP EVOLUTION** — added after the original Phase 0–17 roadmap.
- 🐛 **KNOWN GAP** — confirmed issue or unresolved semantic gap in current source.
- ℹ️ **LIMITATION** — intentional/known design boundary rather than a correctness bug.

## 3. Executive status

| Phase | Area | Current status |
| ---: | --- | --- |
| 0 | Backend Bootstrap | ✅ Implemented |
| 1 | Database Foundation & Shared Primitives | ✅ Implemented |
| 2 | Setup, Password Authentication & Sessions | ✅ Implemented |
| 3 | Optional TOTP MFA | ✅ Implemented |
| 4 | Admin User Management & Quota | ✅ Implemented |
| 5 | Node Tree: Folder, Rename & Move | ✅ Implemented |
| 6 | Folder ACL | ✅ Implemented |
| 7 | Discord BlobStore & Chunks | ✅ Implemented |
| 8 | Upload Sessions, Resumability & Deduplication | ✅ Implemented |
| 9 | File Streaming & HTTP Range | ✅ Implemented |
| 10 | Folder Upload & Folder Download | ✅ Implemented |
| 11 | Trash, Soft Delete & Restore | ✅ Implemented |
| 12 | Collections & Collection ACL | ✅ Implemented |
| 13 | Public Shares | ✅ Implemented |
| 14 | Search, Filters & Favorites | ⚠️ Implemented; representative plan acceptance still needs recorded evidence |
| 15 | MIME & Media Metadata | ✅ Implemented |
| 16 | Operational Hardening | ✅ Implemented |
| 17 | Backend Stabilization | ⚠️ Implementation/harness complete; final verification evidence incomplete |

### Backend freeze state

The backend is currently used as the stable API/domain source of truth for the web client. New backend changes should therefore be limited to:

1. correctness/security bugs;
2. real API contract blockers discovered by the web client;
3. explicitly approved product evolution;
4. performance/operational fixes that preserve existing semantics.

Breaking `/api/v1` changes should not be introduced casually. OpenAPI and generated web types must move together.

---

# 4. Current architecture baseline

The current backend remains a **Go + PostgreSQL + Discord-backed general-purpose file-storage server**.

Core architecture:

```text
Web / future desktop clients
            │
            │ HTTP / session cookie
            ▼
      DisCloud Go API
      ├─ setup/auth/MFA
      ├─ users/admin/quota
      ├─ nodes/folders/ACL
      ├─ uploads/chunks
      ├─ files/Range streaming
      ├─ collections/shares
      ├─ search/favorites
      ├─ metadata/jobs
      ├─ avatars/objects/thumbnails
      ├─ settings
      └─ diagnostics/metrics
            │
       ┌────┴─────┐
       ▼          ▼
 PostgreSQL    Discord
 metadata      attachment blobs
```

Important invariants retained from the original design:

- PostgreSQL is the only canonical relational database backend.
- UUIDv7 is used for application identifiers where schema defaults require generated IDs.
- `nodes` is the structural namespace for files/folders.
- Session cookies are the normal browser authentication mechanism.
- TOTP secrets are encrypted at rest; recovery codes are not stored plaintext.
- Quota is based on logical active owned file bytes; unlimited quota is supported.
- File bytes are stored as chunk references backed by Discord attachments.
- Upload finalize must be idempotent.
- Chunk dedupe is global and same-digest races are serialized.
- Streaming does not buffer the whole file in memory.
- ACL/public/collection access must not leak structural information outside authorized scope.
- Soft-deleted files keep committed blob references intact.
- Derived metadata/jobs must not make canonical file storage unavailable when probes fail.

---

# 5. Formal roadmap with current implementation status

## Phase 0 — Backend Bootstrap

**Status: ✅ IMPLEMENTED**

- [x] Initialize Go module, binary entrypoint, application boundary and repository ignore rules.
- [x] Typed runtime configuration, environment loading and validation.
- [x] Structured `slog` logging.
- [x] PostgreSQL pool/connectivity.
- [x] Migration runner and startup migration execution.
- [x] HTTP router/server skeleton and graceful shutdown.
- [x] `/healthz` and PostgreSQL-backed `/readyz`.
- [x] Base HTTP/server tests.
- [x] Development PostgreSQL Compose.
- [x] CI format/vet/test and production Docker foundation.

## Phase 1 — Database Foundation & Shared Primitives

**Status: ✅ IMPLEMENTED**

- [x] PostgreSQL extensions and UUIDv7 foundation.
- [x] PostgreSQL transaction helper and integration tests.
- [x] RFC-style Problem Details model and HTTP helpers.
- [x] Request ID middleware/context.
- [x] Cursor encode/decode primitive with tests/fuzzing.
- [x] `users` and base `nodes` schema with root-node invariants.
- [x] Audit-event schema/repository.
- [x] Jobs schema and PostgreSQL job claim primitive.
- [x] Migration-from-empty integration test.

## Phase 2 — Setup, Password Authentication & Sessions

**Status: ✅ IMPLEMENTED**

- [x] User domain/repository primitives.
- [x] Argon2id password hashing and tests.
- [x] Session schema, secure token generation/hashing and repository.
- [x] Setup-status service and atomic first-admin setup.
- [x] Concurrent setup protection/integration test.
- [x] `GET /api/v1/setup/status` and `POST /api/v1/setup`.
- [x] Login/logout and session-cookie handling.
- [x] Authentication middleware and `GET /api/v1/auth/me`.
- [x] Session listing/revocation.
- [x] Username/password update and revoke-other-sessions.
- [x] Disabled-user authentication enforcement.
- [x] Full auth HTTP integration suite.

## Phase 3 — Optional TOTP MFA

**Status: ✅ IMPLEMENTED**

- [x] MFA schema and encryption master-key configuration.
- [x] Encrypted TOTP secrets with tests.
- [x] Pending enrollment, enrollment start/confirm and TOTP verification.
- [x] Recovery-code generation, hashing, regeneration and one-time login.
- [x] MFA login challenge.
- [x] Disable own MFA and admin MFA reset.
- [x] Concurrency/security integration tests.

## Phase 4 — Admin User Management & Quota

**Status: ✅ IMPLEMENTED**

- [x] Admin authorization primitive.
- [x] Create-user transaction with automatic root folder.
- [x] Admin create/list/detail user APIs.
- [x] Disable user + revoke sessions and re-enable user.
- [x] Admin password reset.
- [x] Quota domain model and locking primitives.
- [x] Admin quota updates and storage usage endpoint.
- [x] Unlimited and finite quota tests.

## Phase 5 — Node Tree: Folder, Rename & Move

**Status: ✅ IMPLEMENTED**

- [x] Node domain model.
- [x] Unicode filename/folder-name normalization and tests.
- [x] Active sibling uniqueness constraint.
- [x] Create-folder repository/service/API.
- [x] Folder child listing and breadcrumbs.
- [x] Rename and move file/folder.
- [x] Folder-cycle detection and root protection.
- [x] Cross-owner restrictions and admin ownership-transfer transaction.
- [x] Concurrent name/move integration tests.

## Phase 6 — Folder ACL

**Status: ✅ IMPLEMENTED**

- [x] `folder_permissions` schema.
- [x] Permission levels `view < edit < full` and ordering helpers.
- [x] Ancestor ACL resolution and authorization service.
- [x] Owner/admin overrides.
- [x] Folder grant create/update/delete/list.
- [x] Permission-aware node detail and child listing.
- [x] Permission audit events.
- [x] ACL matrix and authorization-leakage tests.

## Phase 7 — Discord BlobStore & Chunks

**Status: ✅ IMPLEMENTED**

- [x] `BlobStore` abstraction.
- [x] Discord storage configuration and multi-bot/channel model.
- [x] Discord HTTP client foundation.
- [x] Chunk schema/repository.
- [x] Discord chunk upload and streaming download.
- [x] Chunk Range reads.
- [x] Discord upstream 429/retry handling and storage error classification.
- [x] Fake BlobStore and unit tests.
- [x] Optional live Discord integration harness.

## Phase 8 — Upload Sessions, Resumability & Deduplication

**Status: ✅ IMPLEMENTED**

- [x] `files`, `file_chunks` and upload-session schema.
- [x] Upload state machine and quota reservation transaction.
- [x] Create/status/resume upload APIs.
- [x] Stream incoming parts while hashing and verify expected SHA-256.
- [x] Chunk dedupe lookup and same-digest concurrency coordination.
- [x] Register parts and idempotent part retry.
- [x] Completion validation and atomic logical-file finalize.
- [x] Reserved → used quota transition.
- [x] Cancel/expire abandoned sessions and release reservations.
- [x] Upload concurrency/integration tests.

## Phase 9 — File Streaming & HTTP Range

**Status: ✅ IMPLEMENTED**

- [x] File metadata query/service and endpoint.
- [x] Ordered file-chunk traversal.
- [x] Full reconstruction stream and full content endpoint.
- [x] Download disposition behavior.
- [x] Single byte-range parser with tests/fuzz targets.
- [x] Map byte ranges to chunks and cross-chunk Range streaming.
- [x] ETag/content headers and unsatisfiable Range handling.
- [x] Request cancellation propagation.
- [x] Large-file streaming integration tests.

## Phase 10 — Folder Upload & Folder Download

**Status: ✅ IMPLEMENTED**

- [x] Folder-tree/batch-create contract.
- [x] Batch folder validation and creation transaction.
- [x] Folder tree integration with upload sessions.
- [x] Archive path sanitizer and fuzz tests.
- [x] Recursive ZIP tree walker and streaming ZIP writer.
- [x] Folder download endpoint.
- [x] Nested-folder archive integration tests.
- [x] Multi-selection archive/download support where exposed.

**Current note:** backend folder-tree primitives are present, including batch folder creation and recursive folder download. The remaining folder-upload gap discussed during web development is a **web-client orchestration gap**, not absence of the backend Phase 10 foundation.

## Phase 11 — Trash, Soft Delete & Restore

**Status: ✅ IMPLEMENTED**

- [x] Direct/effective deletion query model.
- [x] Logical byte calculation for trash operations.
- [x] Trash file/folder transactions and immediate quota release.
- [x] Trash listing.
- [x] Restore validation and file/folder restore.
- [x] Restore-to alternate destination and rename-on-conflict flow.
- [x] Restore quota consume/reservation checks.
- [x] Nested direct-delete semantics.
- [x] Committed chunks preserved through soft delete.
- [x] Trash/restore concurrency tests.

**Baseline deviation:** the original Phase 11 explicitly prohibited permanent deletion. Current code later added an explicit database-only `Purge` path. That feature is documented under Post-roadmap evolution rather than retroactively changing the original Phase 11 contract.

## Phase 12 — Collections & Collection ACL

**Status: ✅ IMPLEMENTED**

- [x] Collections schema/domain/repository.
- [x] Create/update/trash/restore collection.
- [x] Collection-item add/remove.
- [x] Collection permission schema/resolution and grant CRUD.
- [x] View file through collection authorization.
- [x] Prevent structural permission escalation.
- [x] Retain membership for soft-deleted files.
- [x] Collection ACL tests.

## Phase 13 — Public Shares

**Status: ✅ IMPLEMENTED**

- [x] Public-share schema and high-entropy share IDs.
- [x] Share ID tests/fuzzing.
- [x] Generic share service.
- [x] Create/revoke file, folder and collection shares.
- [x] Public share resolver.
- [x] Public file metadata/content.
- [x] Public folder browsing/download.
- [x] Public collection browsing.
- [x] Prevent traversal outside shared subtree.
- [x] Revoke shares when resources enter Trash.
- [x] Restore must not reactivate old share IDs.
- [x] Public-share integration tests.

## Phase 14 — Search, Filters & Favorites

**Status: ⚠️ IMPLEMENTED — representative search-plan acceptance evidence remains a release gate**

- [x] Trigram/name search indexes and fuzzy search.
- [x] Permission-aware search repository.
- [x] Stable cursor pagination.
- [x] Kind/MIME/category, size/date and ownership/state filters.
- [x] Folder/collection/favorite/shared filters.
- [x] Sorting by relevance/name/date/size.
- [x] Favorite mutation/filtering.
- [x] Search leakage tests and HTTP contract tests.
- [x] Representative EXPLAIN/benchmark harness.

### Phase 14 verification still required

- [x] Exact-query EXPLAIN harness exists.
- [x] Representative benchmark harness exists.
- [ ] Run/record a representative query plan on the target PostgreSQL environment.
- [ ] Accept or tune the plan based on the captured baseline.

## Phase 15 — MIME & Media Metadata

**Status: ✅ IMPLEMENTED**

- [x] MIME/media metadata fields.
- [x] Content-first MIME detection with extension/MIME-hint fallback.
- [x] MIME → category classification and tests.
- [x] Metadata probe abstraction.
- [x] Async `file.metadata` jobs.
- [x] PNG/JPEG/GIF image dimensions.
- [x] Metadata status/error persistence.
- [x] Expose metadata through file APIs.
- [x] Probe failures never break upload/download.
- [x] Optional richer video/audio and image-format probing.

### Optional enrichment still not required for the core Phase 15 exit

- [ ] Rich WebP/AVIF dimension probing if needed.
- [ ] Optional `ffprobe` adapter for duration/codec/bitrate.
- [ ] Additional media-derived metadata only when product value justifies runtime/dependency cost.

## Phase 16 — Operational Hardening

**Status: ✅ IMPLEMENTED**

- [x] Audit query API and admin storage overview.
- [x] Quota reconciliation query/job.
- [x] Abandoned upload cleanup.
- [x] Safe uncommitted orphan-chunk cleanup.
- [x] Job retry/dead lifecycle, leases and stale-job recovery.
- [x] Worker lifecycle.
- [x] Prometheus-compatible metrics and trace hooks.
- [x] Security headers and final configuration validation.
- [x] Extended readiness checks.
- [x] PostgreSQL backup/restore operations documentation.

## Phase 17 — Backend Stabilization

**Status: ⚠️ IMPLEMENTED — stabilization harness exists; final verification evidence remains**

- [x] Inventory all HTTP routes.
- [x] Finalize OpenAPI schemas/routes and validate API examples.
- [x] Per-operation error/status catalog and HTTP contract guards.
- [x] Range, filename/path, cursor/share-ID and other critical fuzz targets.
- [x] High-risk concurrency regression suite.
- [x] Upload/Range/folder/ACL/search/trash load/performance harnesses.
- [x] Migration sequence/forward-only/destructive-change review guards.
- [x] DB constraints/index review.
- [x] Threat-model/security review and CSRF/session hardening.
- [x] Backend/operations/security documentation review.
- [x] Release checklist.
- [x] Freeze `/api/v1` as the web-client contract.

### Phase 17 implementation coverage

- [x] OpenAPI contract and route drift guard.
- [x] Validated API examples and error/status catalog.
- [x] Fuzz boundaries.
- [x] High-risk concurrency suite.
- [x] Migration sequence/forward-only/destructive-change guards.
- [x] CSRF same-origin hardening and session/cookie review.
- [x] Threat-model baseline.
- [x] Load/performance harness covering all planned workloads.
- [x] Operations/security documentation.
- [x] Release checklist.

### Phase 17 verification evidence still not recorded as complete

- [ ] Actual full race-suite result.
- [ ] Actual extended fuzz-run result.
- [ ] Accepted representative Phase 14 search plan.
- [ ] Recorded/accepted load baseline.
- [ ] Completed PostgreSQL restore rehearsal with representative Discord-backed downloads.

---

# 6. Post-roadmap backend evolution

These capabilities were added **after the original Phase 0–17 roadmap** while the web client was being implemented. They are part of the current backend and therefore belong in the source-of-truth plan even though they are not new formal numbered phases.

## 6.1 Web-enabling API refinements

- 🧭 Current-user usage/quota read support for the authenticated app shell.
- 🧭 MFA-status exposure needed by account/security UI.
- 🧭 Exact active-user lookup used by ACL assignment UI without exposing a browsable user directory to normal users.
- 🧭 Folder child-listing contract refinements for sorting/pagination/browser UX.
- 🧭 OpenAPI error catalog kept in sync with newly added operations.

## 6.2 Direct objects, avatars and thumbnail infrastructure

- 🧭 `internal/objects` provides direct object-storage infrastructure separate from canonical file nodes.
- 🧭 Upload-lease support was added for direct object writes.
- 🧭 `internal/avatars` and avatar HTTP endpoints provide upload/read/delete behavior for user profile images.
- 🧭 `internal/thumbnails` provides derived thumbnail infrastructure.
- 🧭 Attachment URL + expiration data is retained on successful Discord object uploads so already-known CDN URLs can be reused.
- 🧭 Attachment URL resolution is concurrency-bounded to prevent request herds against Discord message lookup.

## 6.3 HTTP/cache delivery hardening

- 🧭 File/binary delivery gained cache and validation headers, including `Cache-Control`/`Last-Modified` support where applicable.
- 🧭 Existing ETag/Range semantics remain part of the content-delivery contract.
- 🧭 Thumbnail/content paths should prefer known attachment URLs and avoid unnecessary Discord API lookup round-trips.

## 6.4 User settings persistence

The backend now persists user configuration used by the web client. Current common settings include at least:

```text
common
├─ timezone
├─ fileBrowserToolbar
│  ├─ variant: inline | dock
│  └─ dockPosition: bottom | right
└─ filePreview
   └─ preloadNext: 3..5
```

Settings changes must remain backward-compatible: clients that update one common setting must not silently reset unrelated settings.

## 6.5 Database-only permanent purge

The original roadmap used soft delete only. Current source later added `nodes.Service.Purge` for an explicitly deleted node/subtree.

Current purge semantics:

- owner or admin only;
- target must already be directly deleted;
- root node cannot be purged;
- active upload references block purge;
- related upload rows, shares, collection membership and folder grants are removed;
- file/chunk relational references are deleted transactionally;
- a chunk row is deleted only if no other file/upload reference remains;
- **physical Discord attachment deletion is not performed by this purge path** (`discordDeleted=false` in audit metadata).

Therefore this is a **database-only permanent delete**, not a full physical erasure guarantee.

---

# 7. Known current gaps and limitations

## 7.1 🐛 Restored file can retain permanently skipped metadata

Current restore logic restores the node, quota and audit event, but does not enqueue a new `file.metadata` job.

Problem scenario:

```text
upload
  ↓
trash before metadata worker finishes
  ↓
metadata worker observes inactive file
  ↓
metadata_status = skipped
  ↓
restore
  ↓
no re-enqueue
  ↓
file can remain skipped indefinitely
```

Required fix:

- [ ] On restore, identify restored file(s) that require metadata processing.
- [ ] Enqueue `file.metadata` after/within a transaction-safe restore workflow.
- [ ] Handle recursive folder restore without creating duplicate jobs.
- [ ] Add regression coverage for `upload → trash → metadata skip → restore → metadata ready`.

## 7.2 🐛 Terminal retry log can say “scheduled for retry” after a job becomes dead

`jobs.Worker.runJob()` currently calls `Retry(...)` and then always logs `job scheduled for retry`. If `Retry` transitions the final attempt to `dead`, the persisted state is correct but the operational log is misleading.

Required fix:

- [ ] Make retry completion expose the resulting state or otherwise distinguish retry vs dead.
- [ ] Log terminal dead state accurately.
- [ ] Add regression coverage around the last allowed attempt.

## 7.3 ℹ️ Truly unregistered Discord orphans are invisible to DB GC

Normal orphan GC can safely remove registered-but-uncommitted chunks. A Discord attachment uploaded successfully **before the process dies prior to DB registration** has no locator in PostgreSQL, so a database-driven sweeper cannot discover it.

Current disposition:

- keep normal GC database-driven and safe;
- do not scan the entire Discord channel during ordinary lifecycle;
- add a separate maintenance/reconciliation tool only if real deployments show meaningful accumulation.

## 7.4 ℹ️ Purge is not physical Discord erasure

Database-only purge intentionally removes relational ownership/references but leaves the Discord attachment itself untouched. Before advertising any “secure/permanent physical delete” semantics, define and test a remote-erasure strategy.

## 7.5 ⚠️ Release verification is incomplete as an evidence set

The backend has the test/harness code, but this plan must not claim release readiness until the following are run and recorded:

- [ ] full `go test -race ./...`;
- [ ] high-risk concurrency suite with repeated scheduler-sensitive runs;
- [ ] extended fuzz session with no unresolved corpus findings;
- [ ] representative search EXPLAIN/benchmark accepted;
- [ ] opt-in load suite baseline recorded;
- [ ] PostgreSQL restore rehearsal completed;
- [ ] representative restored Discord-backed full + Range downloads verified.

---

# 8. Backend release verification gate

## 8.1 Normal quality gate

```bash
gofmt -w .
go vet ./...
go test -race ./...
```

For CI/release, formatting should be checked without modifying the tree.

## 8.2 Scheduler-sensitive concurrency

```bash
go test -race -count=10 -run Concurrent ./internal/setup/...
go test -race -count=10 -run Concurrent ./internal/nodes/...
go test -race -count=10 -run Concurrent ./internal/uploads/...
```

## 8.3 Representative search

```bash
DISCLOUD_TEST_DATABASE_DSN='postgres://discloud:discloud@localhost:5432/discloud?sslmode=disable' \
DISCLOUD_SEARCH_PLAN=1 \
DISCLOUD_SEARCH_PLAN_N=25000 \
go test -run TestSearchPlanRepresentative -count=1 -v ./internal/search

DISCLOUD_TEST_DATABASE_DSN='postgres://discloud:discloud@localhost:5432/discloud?sslmode=disable' \
DISCLOUD_SEARCH_BENCH_N=25000 \
go test -run '^$' -bench BenchmarkSearchRepresentative -benchtime=10x ./internal/search
```

Do not set a hard latency threshold until a representative deployment baseline is recorded.

## 8.4 Opt-in load suite

```bash
DISCLOUD_TEST_DATABASE_DSN='postgres://discloud:discloud@localhost:5432/discloud?sslmode=disable' \
DISCLOUD_RUN_LOAD_TESTS=1 \
go test -run '^TestLoad' -count=1 -v ./internal/uploads/... ./internal/nodes/... ./internal/folders/...
```

The load suite should record workload size/concurrency, machine/DB context and observed results so future releases can compare against a real baseline.

## 8.5 PostgreSQL restore rehearsal

A backup is not considered verified until it has been restored to a separate empty database and the restored application has been exercised.

Minimum checklist:

- [ ] restore completes successfully;
- [ ] application starts and `/readyz` succeeds;
- [ ] administrator login works;
- [ ] MFA secrets decrypt using the original master key;
- [ ] root folders, ACLs and collections load correctly;
- [ ] normal full download works;
- [ ] Range download works;
- [ ] folder ZIP works;
- [ ] public share works;
- [ ] quota/admin diagnostics are sane;
- [ ] representative Discord-backed attachments still exist and can be read.

---

# 9. Rules for future backend changes

## API contract

- `/api/v1` is the web-client contract and should remain backward-compatible.
- Any route/request/response/error change must update OpenAPI in the same change.
- Web generated API types must be regenerated/check-verified when the contract changes.
- New endpoints need explicit authentication/authorization and CSRF semantics.

## Database migrations

- Migrations are forward-only and append-only.
- Never rewrite a migration that may already be deployed.
- Migration numbers remain sequential.
- Destructive DDL requires explicit review and regression coverage.

## Concurrency/invariants

- Preserve owner-tree serialization for operations that mutate structural/quota state.
- Preserve same-digest serialization across dedupe/upload/GC paths.
- Upload finalize must remain idempotent.
- A successful retry/replay must not duplicate quota transitions, audit events, metadata jobs or file-chunk mappings.

## Storage safety

- Canonical committed file chunks are never normal orphan-GC candidates.
- Soft delete must not physically delete committed Discord data.
- Object/thumbnail/avatar derived storage must remain separate from canonical file-node semantics.
- Cache URLs are accelerators, not canonical locators; code must tolerate expiry and re-resolution.

## Derived data

- MIME/media metadata and thumbnails are derived state.
- Probe/thumbnail failure must not make canonical file storage/download unavailable.
- Restore flows must repair/re-enqueue derived state when necessary.

## Observability

- Keep metric label cardinality bounded.
- Use route patterns rather than raw resource IDs in access metrics/log dimensions.
- Never log passwords, session tokens, TOTP secrets, recovery-code plaintext, encryption keys, Discord bot tokens or DB credentials.

---

# 10. Current backend implementation map

Current `internal/` domains include:

```text
acl
adminops
adminusers
app
audit
auth
avatars                # post-roadmap
blobstore
chunks
collections
config
cursor
discordstore
encryption
files
folders
httpapi
jobs
logging
media
mfa
nodes
objects                # post-roadmap
observability
orphangc
postgres
search
settings               # post-roadmap
setup
shares
thumbnails             # post-roadmap
uploads
```

This map is intentionally included because it shows how the implemented backend has grown beyond the original formal phase list without needing to invent Phase 18/19 backend numbering.

---

# 11. Current checkpoint summary

```text
Formal backend roadmap

Phase 0  ───────────── Phase 13   ✅ implemented
Phase 14                           ⚠️ implemented; representative plan evidence pending
Phase 15                           ✅ implemented; richer media probes optional
Phase 16                           ✅ implemented
Phase 17                           ⚠️ implementation/harness complete; final verification evidence pending

Post-roadmap backend evolution
avatars / objects / leases / thumbnails / cache validators / user settings / purge
                                 🧭 implemented after formal freeze

Known current gaps
metadata re-enqueue on restore     🐛
terminal retry logging semantics  🐛
unregistered Discord orphan scan  ℹ️ limitation
physical Discord delete on purge  ℹ️ not provided
```

The correct high-level statement today is:

> **The formal backend feature roadmap is implemented through Phase 17 and is stable enough to serve as the web-client contract, but the project should not call the backend fully release-verified until the remaining race/fuzz/search/load/restore evidence is recorded and the two known correctness/operational gaps above are resolved or explicitly accepted.**

---

# 12. Sources used for this checkpoint

This rewrite was derived from:

- the original 18-phase backend roadmap in the exported project conversation;
- the original `docs/BACKEND_IMPLEMENTATION_PLAN.md` on `main`;
- the Phase 14–17 implementation/status checkpoints from the conversation;
- the current `main` source tree and recent backend commits as of 2026-08-20;
- current-source confirmation of `nodes.Restore`, `nodes.Purge` and `jobs.Worker` behavior.

Update this file whenever a remaining backend verification gate is completed, a known gap is fixed, or a post-roadmap extension changes the API/data contract.
