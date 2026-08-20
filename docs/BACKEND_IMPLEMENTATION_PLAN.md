# DisCloud Backend Implementation Plan

> Implementation-aware source of truth for the current backend.
>
> Snapshot: **2026-08-21**
>
> Repository: `mewisme/discloud` · branch `main`
>
> Formal roadmap: **18 phases, Phase 0 through Phase 17**.
>
> Current backend posture: **the formal feature roadmap is implemented through Phase 17 and the backend is the stable contract for the web client. Final release-verification evidence is still incomplete, while post-roadmap product evolution continues through backward-compatible API/domain refinements.**

## 1. Purpose

This document is no longer a from-scratch implementation checklist. It records:

- formal Phase 0–17 implementation status;
- release-verification evidence that is still required;
- post-roadmap backend evolution added for the web client;
- current identity/workspace invariants;
- known gaps and intentional limitations;
- the rules that future backend changes must preserve.

The implementation history after the original roadmap must not be converted into invented Phase 18/19 backend numbering. New capabilities remain **post-roadmap evolution** unless the roadmap is explicitly re-baselined.

## 2. Status legend

- ✅ **IMPLEMENTED** — formal phase code/contract exists.
- ⚠️ **IMPLEMENTED, VERIFICATION PENDING** — code/harness exists, but acceptance evidence is not fully recorded.
- 🧭 **POST-ROADMAP EVOLUTION** — product capability added after formal Phase 17 implementation.
- 🐛 **KNOWN GAP** — confirmed correctness/operational issue still requiring a fix or explicit acceptance.
- ℹ️ **LIMITATION** — intentional design boundary, not a correctness bug.

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
| 14 | Search, Filters & Favorites | ⚠️ Implemented; representative query-plan acceptance still needs recorded evidence |
| 15 | MIME & Media Metadata | ✅ Implemented |
| 16 | Operational Hardening | ✅ Implemented |
| 17 | Backend Stabilization | ⚠️ Implementation/harness complete; final verification evidence incomplete |

### Backend freeze state

The backend is the stable API/domain source of truth for the web client. New backend work should normally be limited to:

1. correctness/security fixes;
2. real API blockers discovered by clients;
3. explicitly approved backward-compatible product evolution;
4. performance/operational fixes that preserve semantics.

Breaking `/api/v1` changes must not be introduced casually. OpenAPI and generated web types must move together.

---

# 4. Current architecture baseline

DisCloud remains a **Go + PostgreSQL + Discord-backed general-purpose file-storage server**.

```text
Web / future clients
        │
        │ HTTP + session cookie
        ▼
    DisCloud Go API
    ├─ setup/auth/MFA
    ├─ users/admin/quota
    ├─ workspaces/identity
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
PostgreSQL   Discord
metadata     attachment blobs
```

## 4.1 Core invariants

- PostgreSQL is the canonical relational database.
- UUIDv7 is used for application identifiers where schema defaults generate IDs.
- `nodes` is the structural namespace for files/folders.
- Session cookies are the normal browser authentication mechanism.
- TOTP secrets are encrypted at rest; recovery codes are never stored plaintext.
- Quota uses logical active owned file bytes; unlimited quota is supported.
- Canonical file bytes are chunk references backed by Discord attachments.
- Upload finalize is idempotent.
- Same-digest races are serialized across dedupe-sensitive paths.
- File streaming does not buffer the whole file in memory.
- ACL/public/collection access must not leak unauthorized structural information.
- Soft-deleted files keep committed blob references intact.
- MIME/media metadata and thumbnails are derived state and must not make canonical file download unavailable when derivation fails.

## 4.2 Identity invariants added after the original roadmap

The current identity model is now explicit:

```text
username = immutable technical identity
name     = mutable display identity
```

Rules:

- login remains username-based;
- workspace routing remains username-based;
- exact identity references use `@username`;
- display surfaces should prefer `name`, with `@username` available where disambiguation matters;
- username is immutable through self-service and admin update flows;
- setup/admin create require both `name` and `username`;
- `name` is mutable and constrained to 1–100 characters;
- changing a display name must never change login identity or workspace routes.

---

# 5. Formal roadmap with current implementation status

## Phase 0 — Backend Bootstrap

**Status: ✅ IMPLEMENTED**

- [x] Go module, application boundary and binary entrypoint.
- [x] Typed runtime configuration and validation.
- [x] Structured logging.
- [x] PostgreSQL pool and startup migration execution.
- [x] HTTP server/router and graceful shutdown.
- [x] `/healthz` and PostgreSQL-backed `/readyz`.
- [x] CI/test/Docker development foundation.

## Phase 1 — Database Foundation & Shared Primitives

**Status: ✅ IMPLEMENTED**

- [x] PostgreSQL extensions and UUIDv7 foundation.
- [x] Transaction helpers and integration coverage.
- [x] Problem Details HTTP model.
- [x] Request IDs.
- [x] Cursor primitives and fuzz/tests.
- [x] `users`, `nodes`, audit and jobs foundation.
- [x] Migration-from-empty verification harness.

## Phase 2 — Setup, Password Authentication & Sessions

**Status: ✅ IMPLEMENTED**

- [x] Argon2id password hashing.
- [x] First-admin setup and concurrent setup protection.
- [x] Login/logout/session cookies.
- [x] `GET /api/v1/auth/me`.
- [x] Session listing/revocation.
- [x] Password change and revoke-other-sessions.
- [x] Disabled-user enforcement.

**Current post-roadmap identity refinement:** usernames are immutable; self-service account identity updates modify `name`, not `username`.

## Phase 3 — Optional TOTP MFA

**Status: ✅ IMPLEMENTED**

- [x] Encrypted TOTP secrets.
- [x] Enrollment start/confirm.
- [x] Recovery codes and MFA login challenge.
- [x] Disable own MFA and admin MFA reset.
- [x] Concurrency/security coverage.

## Phase 4 — Admin User Management & Quota

**Status: ✅ IMPLEMENTED**

- [x] Admin authorization primitive.
- [x] User create transaction with root folder.
- [x] List/detail/update/disable/enable APIs.
- [x] Admin password reset.
- [x] Finite/unlimited quota management.
- [x] Storage usage APIs and reconciliation foundation.

**Current credential refinement:**

- admin create/reset password is a **temporary credential** and only requires at least 1 Unicode character;
- temporary credentials set/retain the must-change-password lifecycle;
- the user's real/new password continues to require at least 12 characters;
- temporary-password validation is intentionally separate from normal password-strength validation.

## Phase 5 — Node Tree: Folder, Rename & Move

**Status: ✅ IMPLEMENTED**

- [x] Node model and Unicode name normalization.
- [x] Active sibling uniqueness.
- [x] Create folder/list children/breadcrumbs.
- [x] Rename/move.
- [x] Cycle/root/cross-owner protection.
- [x] Admin ownership transfer.
- [x] Concurrency regression coverage.

## Phase 6 — Folder ACL

**Status: ✅ IMPLEMENTED**

- [x] Folder permissions schema.
- [x] `view < edit < full` resolution.
- [x] Inherited ACL resolution and owner/admin overrides.
- [x] Grant CRUD/list.
- [x] Permission-aware node browsing.
- [x] ACL audit and leakage tests.

## Phase 7 — Discord BlobStore & Chunks

**Status: ✅ IMPLEMENTED**

- [x] `BlobStore` abstraction.
- [x] Discord storage configuration and client.
- [x] Chunk repository and attachment upload/read.
- [x] Range support.
- [x] 429/retry/error classification.
- [x] Fake store and optional live integration harness.

## Phase 8 — Upload Sessions, Resumability & Deduplication

**Status: ✅ IMPLEMENTED**

- [x] Upload sessions/parts/files/file-chunks schema.
- [x] Quota reservation.
- [x] Resume/status APIs.
- [x] Stream + hash incoming parts.
- [x] Chunk dedupe and same-digest concurrency coordination.
- [x] Idempotent retry/finalize.
- [x] Reservation-to-used quota transition.
- [x] Cancel/expiry cleanup.

## Phase 9 — File Streaming & HTTP Range

**Status: ✅ IMPLEMENTED**

- [x] File metadata service/API.
- [x] Ordered chunk traversal.
- [x] Full stream and download disposition.
- [x] Single-range parser and cross-chunk mapping.
- [x] ETag/content headers and unsatisfiable Range handling.
- [x] Cancellation propagation.

## Phase 10 — Folder Upload & Folder Download

**Status: ✅ IMPLEMENTED**

- [x] Batch folder-tree creation contract.
- [x] Merge-safe folder resolution.
- [x] Folder upload integration with upload sessions.
- [x] Archive path sanitizer and fuzzing.
- [x] Recursive ZIP streaming.
- [x] Folder download and multi-selection archive support.

Current merge semantics support the web client's complete folder-tree upload flow:

- existing folders are reused;
- missing descendants are created;
- already-existing files can be classified separately from structural file-vs-folder conflicts;
- existing server-only children are not overwritten.

## Phase 11 — Trash, Soft Delete & Restore

**Status: ✅ IMPLEMENTED**

- [x] Direct/effective deletion model.
- [x] Logical byte accounting.
- [x] Trash and immediate quota release.
- [x] Trash listing.
- [x] Restore, alternate destination and rename-on-conflict.
- [x] Restore quota checks.
- [x] Nested delete semantics.
- [x] Committed chunks preserved during soft delete.

A later database-only `Purge` path is post-roadmap evolution and does not change the original soft-delete Phase 11 baseline.

## Phase 12 — Collections & Collection ACL

**Status: ✅ IMPLEMENTED**

- [x] Collection CRUD/trash/restore.
- [x] Collection membership.
- [x] Collection grant CRUD/resolution.
- [x] Collection-only file authorization without structural escalation.

## Phase 13 — Public Shares

**Status: ✅ IMPLEMENTED**

- [x] High-entropy public share IDs.
- [x] File/folder/collection shares.
- [x] Anonymous resolver and content/browser endpoints.
- [x] Shared subtree confinement.
- [x] Revocation on trash.
- [x] Restore does not reactivate old public IDs.

## Phase 14 — Search, Filters & Favorites

**Status: ⚠️ IMPLEMENTED — representative search-plan acceptance evidence remains a release gate**

- [x] Trigram/fuzzy search.
- [x] Permission-aware search.
- [x] Stable cursor pagination.
- [x] Kind/MIME/category/size/date/owner/state filters.
- [x] Folder/collection/favorite/shared filters.
- [x] Relevance/name/date/size sorting.
- [x] Favorite mutations.
- [x] Search leakage and HTTP contract tests.
- [x] Representative EXPLAIN/benchmark harness.
- [x] Admin owner filtering required by workspace-aware management flows.

Remaining evidence:

- [ ] Record a representative query plan on the target PostgreSQL environment.
- [ ] Accept or tune the plan against a recorded baseline.

## Phase 15 — MIME & Media Metadata

**Status: ✅ IMPLEMENTED**

- [x] MIME/category fields and content-first detection.
- [x] Async metadata jobs.
- [x] Common image dimensions.
- [x] Metadata status/error persistence.
- [x] Metadata exposed through file APIs.
- [x] Probe failures do not break canonical file access.

Optional enrichment remains non-blocking:

- [ ] richer WebP/AVIF dimensions if product value requires it;
- [ ] optional `ffprobe` duration/codec/bitrate adapter.

## Phase 16 — Operational Hardening

**Status: ✅ IMPLEMENTED**

- [x] Audit query API and storage overview.
- [x] Quota reconciliation.
- [x] Abandoned-upload cleanup.
- [x] Safe uncommitted orphan-chunk cleanup.
- [x] Job retries/dead lifecycle/leases/stale recovery.
- [x] Worker lifecycle.
- [x] Metrics and trace hooks.
- [x] Security headers/config validation/readiness checks.
- [x] Backup/restore operations documentation.

## Phase 17 — Backend Stabilization

**Status: ⚠️ IMPLEMENTED — stabilization harness exists; final verification evidence remains**

- [x] HTTP route inventory.
- [x] OpenAPI finalization and examples.
- [x] Per-operation error/status catalog.
- [x] Critical fuzz targets.
- [x] High-risk concurrency suite.
- [x] Upload/Range/folder/ACL/search/trash load/performance harnesses.
- [x] Migration sequence/forward-only/destructive-change guards.
- [x] Constraint/index review.
- [x] CSRF/session/security review.
- [x] Operations/security docs and release checklist.
- [x] `/api/v1` frozen as the web-client contract baseline.

Still not recorded as complete:

- [ ] full race-suite result;
- [ ] extended fuzz-run result;
- [ ] accepted representative Phase 14 search plan;
- [ ] recorded/accepted load baseline;
- [ ] PostgreSQL restore rehearsal with representative Discord-backed downloads.

---

# 6. Post-roadmap backend evolution

## 6.1 Web-enabling API refinements

Implemented after the original Phase 17 feature freeze:

- 🧭 current-user usage/quota read support;
- 🧭 MFA-status exposure for account/security UI;
- 🧭 exact active-user lookup for ACL assignment without a normal-user browsable directory;
- 🧭 richer folder-browser sorting/pagination contracts;
- 🧭 upload conflict classification separating an already-existing file from a structural name/type collision while preserving HTTP `409`;
- 🧭 owner-scoped search/workspace contracts used by admin workspace views;
- 🧭 OpenAPI error/status catalog updates kept synchronized with all added operations.

## 6.2 Display names and immutable usernames

Landed identity model:

- 🧭 users expose mutable `name` plus immutable `username`;
- 🧭 setup requires `name`, `username`, password;
- 🧭 admin create requires `name`, `username`, temporary password;
- 🧭 self update modifies `name`, not username;
- 🧭 admin update modifies `name`/role, not username;
- 🧭 user lookup responses include both `name` and `username`;
- 🧭 OpenAPI/generated web types were updated with the same identity model.

This is now a permanent API/domain invariant. Do not reintroduce username rename semantics without an explicit migration/product decision.

## 6.3 Workspace contract

The backend now exposes:

```text
GET /api/v1/workspaces/{username}
```

Current semantics:

- a normal user can load only their own workspace;
- an admin can load another existing user's workspace;
- the route returns owner identity (`id`, `username`, `name`, `role`, `status`), root information and usage/quota information;
- workspace identity is routed by immutable username;
- authenticated actor identity remains separate from workspace owner identity.

Conceptually:

```text
actor/session user ≠ workspace owner
```

This distinction must remain explicit in authorization, auditing and future workspace-aware operations.

## 6.4 ACL/shared identity enrichment

- 🧭 access-grant responses include display `name` plus exact `username`;
- 🧭 shared-item responses include owner display name in addition to owner username/ID;
- 🧭 these fields allow the web client to present human-readable identity without replacing the technical identity needed for exact routing/mentions.

## 6.5 Admin user identity, avatars and temporary credentials

- 🧭 `AdminUser` includes display name, `hasAvatar` and `avatarRevision`;
- 🧭 admin user avatar read endpoint is available;
- 🧭 admin create/reset uses the separate temporary-password validation path;
- 🧭 temporary passwords may be one Unicode character or longer;
- 🧭 user-selected real passwords still require at least 12 characters;
- 🧭 admin lifecycle integration tests cover identity and temporary-credential behavior.

## 6.6 Admin diagnostics identity enrichment

### Upload diagnostics

Upload diagnostics now expose both technical IDs and human identity for both sides of the operation:

```text
actorUserId / actorUsername / actorName
ownerUserId / ownerUsername / ownerName
```

Technical UUID filters remain supported for diagnostics and auditing.

### Quota reconciliation

Quota reconciliation results now include:

```text
userId / username / name
quota and before/after used/reserved counters
changed / overQuota
```

Results are presentation-friendly while retaining UUID identity for technical correlation.

### Audit events

Audit events now expose:

- actor `name` + `username` when the actor is a user;
- resource `name` + `username` when `resource_type = 'user'`;
- technical resource UUID for correlation;
- non-user resources remain technical rather than inventing human identity.

## 6.7 Recursive folder size in browser listings

Folder browser child responses now use a recursive subtree aggregate:

```text
folder size = SUM(size_bytes of active descendant files)
```

Semantics:

- file size remains the logical file `size_bytes`;
- folder size includes files in all nested descendant folders;
- deleted descendants are excluded;
- empty folders report `0`;
- `sort=size` uses the same recursive aggregate rather than treating folders as zero;
- the implementation uses a recursive CTE instead of client-side aggregation or N+1 queries.

Because this was added after the earlier release-performance checkpoint, representative large-tree browser-size performance should be included in final release verification.

## 6.8 Direct objects, avatars and thumbnails

- 🧭 `internal/objects` provides direct object infrastructure separate from canonical file nodes.
- 🧭 upload leases protect direct object writes.
- 🧭 `internal/avatars` implements user avatar upload/read/delete.
- 🧭 `internal/thumbnails` implements derived thumbnail storage.
- 🧭 known Discord attachment URLs/expiry can be reused instead of resolving every request through Discord message lookup.
- 🧭 attachment resolution is concurrency-bounded.

## 6.9 HTTP/cache delivery hardening

- 🧭 content delivery includes cache/validation headers where applicable;
- 🧭 ETag/Range semantics remain part of the canonical file contract;
- 🧭 thumbnail/object paths should prefer known attachment URLs and tolerate URL expiry/re-resolution.

## 6.10 User settings persistence

Current common configuration includes at least:

```text
common
├─ timezone
├─ fileBrowserToolbar
│  ├─ variant: inline | dock
│  └─ dockPosition: bottom | right
└─ filePreview
   └─ preloadNext: 3..5
```

Partial settings updates must not silently reset unrelated configuration.

## 6.11 Database-only permanent purge

Current `nodes.Service.Purge` semantics:

- owner/admin only;
- target must already be directly deleted;
- root cannot be purged;
- active upload references block purge;
- related upload/share/collection/grant relations are removed;
- file/chunk relational references are deleted transactionally;
- a chunk row is deleted only when no other file/upload reference remains;
- physical Discord attachment deletion is not performed by this path.

This is database-level permanent deletion, **not** a physical-erasure guarantee.

## 6.12 Recent landed checkpoint delta

The main implementation delta since the previous plan snapshot includes:

```text
79ea2df  feat(api): owner-scoped workspace contracts
b98a172  feat(api): classify existing file upload conflicts
914c7b7  feat(users): display names + immutable usernames
913f386  feat(api): workspace details endpoint
c13dacb  feat(api, web): workspace display name details
119cbe7  feat(api, web): display names in access grants/shared items
3af3225  feat(admin): user identity + temporary credentials
64360d4  feat(admin): upload diagnostic actor/owner identity
d82faca  feat(admin): quota reconciliation identity/reporting
40d4eb6  fix(auth): temporary-password/account regression fixes
4e2a140  feat(admin): audit user-resource identity
85991be  feat(nodes): recursive folder sizes in browser listings
```

---

# 7. Known current gaps and limitations

## 7.1 🐛 Restored file can retain permanently skipped metadata

Problem scenario:

```text
upload
  ↓
trash before metadata worker finishes
  ↓
metadata worker marks inactive file skipped
  ↓
restore
  ↓
no metadata re-enqueue
```

Required disposition:

- [ ] identify restored files requiring metadata work;
- [ ] enqueue `file.metadata` safely during/after restore;
- [ ] avoid duplicate jobs for recursive folder restore;
- [ ] add regression coverage for `upload → trash → skipped → restore → ready`.

## 7.2 🐛 Terminal retry log can say “scheduled for retry” after a job becomes dead

Persisted state is correct, but the terminal attempt can produce misleading operational logging.

Required disposition:

- [ ] expose/determine resulting retry state;
- [ ] log final dead state accurately;
- [ ] add last-attempt regression coverage.

## 7.3 ℹ️ Truly unregistered Discord orphans are invisible to DB GC

An attachment uploaded to Discord before process death but before DB registration has no PostgreSQL locator. Normal DB-driven GC cannot discover it.

Current disposition:

- keep normal GC database-driven and safe;
- do not scan entire Discord channels during normal lifecycle;
- add a separate reconciliation/maintenance tool only if deployments show meaningful accumulation.

## 7.4 ℹ️ Purge is not physical Discord erasure

Do not advertise secure physical deletion until a Discord attachment erasure strategy is explicitly implemented and tested.

## 7.5 ⚠️ Release verification is incomplete as an evidence set

The implementation/harness exists, but the project should not claim fully release-verified backend status until the remaining evidence is recorded.

---

# 8. Backend release-verification gate

## 8.1 Normal quality gate

```bash
gofmt -w .
go vet ./...
go test ./...
go test -race ./...
```

CI/release should check formatting without mutating the tree.

## 8.2 Scheduler-sensitive concurrency

```bash
go test -race -count=10 -run Concurrent ./internal/setup/...
go test -race -count=10 -run Concurrent ./internal/nodes/...
go test -race -count=10 -run Concurrent ./internal/uploads/...
```

## 8.3 Representative search acceptance

```bash
DISCLOUD_TEST_DATABASE_DSN='postgres://discloud:discloud@localhost:5432/discloud?sslmode=disable' \
DISCLOUD_SEARCH_PLAN=1 \
DISCLOUD_SEARCH_PLAN_N=25000 \
go test -run TestSearchPlanRepresentative -count=1 -v ./internal/search

DISCLOUD_TEST_DATABASE_DSN='postgres://discloud:discloud@localhost:5432/discloud?sslmode=disable' \
DISCLOUD_SEARCH_BENCH_N=25000 \
go test -run '^$' -bench BenchmarkSearchRepresentative -benchtime=10x ./internal/search
```

Do not invent a hard latency threshold before a representative deployment baseline exists.

## 8.4 Opt-in load suite

```bash
DISCLOUD_TEST_DATABASE_DSN='postgres://discloud:discloud@localhost:5432/discloud?sslmode=disable' \
DISCLOUD_RUN_LOAD_TESTS=1 \
go test -run '^TestLoad' -count=1 -v ./internal/uploads/... ./internal/nodes/... ./internal/folders/...
```

Record workload size/concurrency, machine/DB context and observed results.

## 8.5 New representative browser-folder-size check

Because recursive folder sizing landed after the earlier performance checkpoint:

- [ ] create a representative deep/wide folder hierarchy;
- [ ] capture EXPLAIN/ANALYZE for browser listing sorted by name and by size;
- [ ] verify deleted descendants are excluded;
- [ ] verify `sort=size` pagination remains stable;
- [ ] record whether recursive CTE performance is acceptable at target scale.

This is a release-performance verification item, not a reason to change the current API contract prematurely.

## 8.6 PostgreSQL restore rehearsal

Minimum acceptance:

- [ ] restore into a separate empty database;
- [ ] application starts and `/readyz` succeeds;
- [ ] admin login works;
- [ ] MFA secrets decrypt using the original master key;
- [ ] root folders/workspaces/ACLs/collections load correctly;
- [ ] normal full download works;
- [ ] Range download works;
- [ ] folder ZIP works;
- [ ] public share works;
- [ ] quota/admin diagnostics are sane;
- [ ] representative Discord-backed attachments are readable.

---

# 9. Rules for future backend changes

## 9.1 API contract

- `/api/v1` remains backward-compatible.
- Route/request/response/error changes update OpenAPI in the same change.
- Generated web API types must be regenerated or drift-checked when contracts change.
- Every new endpoint requires explicit authentication/authorization and CSRF semantics.

## 9.2 Identity and workspace

- `username` is immutable technical identity.
- `name` is mutable display identity.
- Login and workspace routes remain username-based.
- Admin cross-workspace access does not impersonate the workspace owner.
- Actor/session identity and workspace-owner identity must remain separate in authorization, diagnostics and audit records.
- Human-facing API responses may add display names, but must not remove exact technical IDs/usernames required for correlation.

## 9.3 Database migrations

- Forward-only and append-only.
- Never rewrite a deployed migration.
- Keep migration numbers sequential.
- Destructive DDL requires explicit review and regression coverage.

## 9.4 Concurrency/invariants

- Preserve owner-tree serialization for structural/quota mutations.
- Preserve same-digest serialization across dedupe/upload/GC paths.
- Upload finalize stays idempotent.
- Retry/replay must not duplicate quota transitions, audit events, metadata jobs or chunk mappings.

## 9.5 Storage safety

- Canonical committed file chunks are never normal orphan-GC candidates.
- Soft delete does not physically delete committed Discord data.
- Object/thumbnail/avatar derived storage remains separate from canonical file-node semantics.
- Cached Discord URLs are accelerators, not canonical locators.

## 9.6 Derived data

- MIME/media metadata and thumbnails are derived.
- Derived-data failure must not block canonical storage/download.
- Restore flows should repair or re-enqueue derived state when required.

## 9.7 Observability

- Keep metric labels bounded.
- Prefer route patterns over raw IDs in metric dimensions.
- Never log passwords, session tokens, TOTP secrets, recovery-code plaintext, encryption keys, Discord bot tokens or DB credentials.

---

# 10. Current backend implementation map

```text
internal/
├─ acl
├─ adminops
├─ adminusers
├─ app
├─ audit
├─ auth
├─ avatars                # post-roadmap
├─ blobstore
├─ chunks
├─ collections
├─ config
├─ cursor
├─ discordstore
├─ encryption
├─ files
├─ folders
├─ httpapi
├─ jobs
├─ logging
├─ media
├─ mfa
├─ nodes
├─ objects                # post-roadmap
├─ observability
├─ orphangc
├─ postgres
├─ search
├─ settings               # post-roadmap
├─ setup
├─ shares
├─ thumbnails             # post-roadmap
└─ uploads
```

The map intentionally shows growth beyond the formal Phase 0–17 roadmap without inventing new backend phase numbers.

---

# 11. Current checkpoint summary

```text
Formal backend roadmap

Phase 0  ───────────── Phase 13   ✅ implemented
Phase 14                           ⚠️ implemented; representative plan evidence pending
Phase 15                           ✅ implemented; richer media probes optional
Phase 16                           ✅ implemented
Phase 17                           ⚠️ implementation/harness complete; final verification evidence pending

Major post-roadmap evolution

identity: display name + immutable username
workspace endpoint + owner-scoped contracts
admin temporary credentials + avatars
ACL/shared identity enrichment
upload diagnostics actor/owner identity
quota reconciliation identity/reporting
audit actor + user-resource identity
recursive folder browser sizes
objects / thumbnails / settings / purge
                                 🧭 implemented

Known gaps
metadata re-enqueue on restore     🐛
terminal retry logging semantics  🐛
unregistered Discord orphan scan  ℹ️ limitation
physical Discord delete on purge  ℹ️ not provided
```

The correct high-level statement is:

> **The DisCloud backend is feature-complete through formal Phase 17 and currently supports the web client's identity/workspace/admin/browser requirements. It should not yet be called fully release-verified until the remaining race/fuzz/search/load/restore evidence, recursive folder-size performance check, and known-gap dispositions are completed.**

---

# 12. Source/checkpoint note

This checkpoint was updated from:

- the existing `docs/BACKEND_IMPLEMENTATION_PLAN.md` on `main`;
- the original 18-phase backend roadmap and established Phase 14–17 verification requirements;
- current `main` source and commits through **2026-08-21**;
- current workspace authorization, recursive browser sizing, admin diagnostics, quota reconciliation and authentication/password implementations.

Update this file whenever:

1. a remaining release-verification gate is completed;
2. a known gap is fixed or explicitly accepted;
3. a post-roadmap backend extension changes an API/data/identity invariant.
