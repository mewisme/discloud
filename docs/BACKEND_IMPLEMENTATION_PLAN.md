# DisCloud Backend — Detailed Implementation Plan

> Status: baseline architecture for a from-scratch backend implementation.
>
> Scope: backend only. Web client will consume the API later. Desktop client is explicitly deferred.
>
> Database: PostgreSQL only.

## 1. Purpose

This document is the implementation source of truth for the new DisCloud backend. The new backend is **not** an incremental refactor of the current `discloud-go` codebase. It is a clean implementation that can reuse product ideas and protocol lessons, but it should not preserve legacy API contracts, legacy database layout, CLI behavior, SQLite support, or compatibility layers unless a new requirement explicitly needs them.

The product is a self-hosted, Discord-backed file storage server with:

- multi-user accounts managed by administrators;
- optional MFA;
- hierarchical folders;
- file and folder upload/download;
- resumable/chunked uploads;
- global chunk deduplication;
- user storage quotas with unlimited as the default;
- administrator override over all users and resources;
- folder and collection sharing through internal ACLs;
- public share links without passwords, API tokens, or access-token query parameters;
- soft-delete only, with indefinite restore support;
- rich MIME/media metadata so the later web client can provide previews and galleries;
- PostgreSQL as the single relational datastore;
- Go as the backend implementation language.

## 2. Frozen product requirements

The following requirements are considered baseline and should not be silently changed during implementation.

### 2.1 Identity and authentication

- Initial installation has no user.
- The first access performs a one-time setup and creates the first administrator.
- Setup requires both `username` and `password`.
- User-facing auth pages later will be `/login` and `/logout`.
- Backend auth endpoints are versioned API routes.
- There is no public registration.
- Administrators can create users.
- Optional MFA is supported per account.
- Initial MFA implementation uses TOTP plus recovery codes.
- No PAT, API key, bearer API token, or token scopes are exposed to users.
- Web authentication uses server-side sessions with secure cookies.
- Later desktop clients may use the same session model over the API.

### 2.2 Users and administrator authority

- The first account is an administrator.
- The schema may support more than one administrator, even if the initial UI exposes only one bootstrap admin.
- Administrators can access, move, restore, share, and manage all files/folders/collections regardless of ACLs.
- Administrators can create, disable, re-enable, reset password, reset MFA, and set quota for users.
- User storage quota is unlimited by default.
- Administrators can set a finite logical storage quota per user.

### 2.3 Files and folders

- Files are private by default.
- Folders are first-class hierarchical resources.
- Users can create folders where they have sufficient permission.
- Users can rename and move files/folders where permitted.
- Users can upload individual files, multiple files, and complete folder trees.
- Users can download individual files and complete folders.
- Folder downloads are streamed archives rather than prebuilt temporary archives whenever possible.
- All MIME types can be stored.
- Media types receive richer metadata and later richer preview support, but the product remains a general-purpose file storage system.

### 2.4 Internal sharing and ACL

- A user cannot access another user's resources unless access is granted through a folder or collection, except administrators who always have full access.
- Folder permission levels are:
  - `view`
  - `edit`
  - `full`
- Folder grants inherit to descendants.
- Collections also expose `view`, `edit`, and `full` levels, with collection-specific semantics described later.
- No explicit `deny` rule is required in the first version.
- No direct per-file ACL is required in the first version; file access primarily derives from ownership, folder inheritance, collection access, or admin override.

### 2.5 Public sharing

- A file, folder, or collection can generate a public share link.
- A generated share link is intentionally public to anyone who possesses the URL.
- Public shares do not use passwords.
- Public shares do not use download limits.
- Public shares do not expire automatically.
- Public shares do not use API tokens or access-token query parameters.
- Public shares can be revoked.
- Regenerating a share creates a new public identifier; the previous link remains revoked.
- A deleted resource is never publicly accessible.

### 2.6 Quota and deletion

- User quotas measure **logical active owned file size**, not physical Discord storage.
- Deduplicated files still consume full logical quota for each logical file owner.
- Soft-delete immediately releases logical quota.
- Restore consumes logical quota again.
- Restore must fail if it would exceed a finite quota, unless an administrator explicitly performs a quota override operation.
- There is **no user-facing permanent-delete operation**.
- There is **no empty-trash operation**.
- Soft-deleted resources remain restorable indefinitely.
- Soft-deleted file chunks remain physically stored so restore is always possible.
- Soft-delete does not trigger physical blob garbage collection.
- Technical garbage collection is allowed only for data that never became a committed file, such as abandoned unreferenced upload chunks.

### 2.7 Removed legacy features

The new backend does not implement:

- SQLite;
- CLI;
- self-managed `.discloud` bundles;
- public registration;
- anonymous uploads;
- CAPTCHA;
- application-level upload/download rate limits;
- PAT/API key authentication;
- access-token shares;
- password shares;
- download-count restrictions;
- share expiry;
- file retention/expiry;
- legacy visibility modes;
- legacy API compatibility.

## 3. Explicit non-goals for the first backend release

The backend architecture should leave room for these, but they are not required for the first complete backend milestone:

- desktop application;
- mobile application;
- S3-compatible API;
- WebDAV;
- OAuth/OIDC social login;
- passkeys/WebAuthn;
- full-text indexing of document contents;
- server-side document conversion;
- mandatory video transcoding;
- distributed multi-region backend;
- end-to-end client-side encryption;
- explicit ACL deny rules;
- file version history;
- permanent deletion of committed files.

## 4. High-level architecture

```text
                    +-----------------------+
                    |      Future Web       |
                    |       Client          |
                    +-----------+-----------+
                                |
                         HTTPS / JSON API
                                |
                    +-----------v-----------+
                    |       Go Backend      |
                    |                       |
                    | HTTP/API              |
                    | Auth + MFA            |
                    | Users + Admin         |
                    | File/Folder domain    |
                    | ACL                   |
                    | Collections           |
                    | Upload orchestration  |
                    | Quota                 |
                    | Public sharing        |
                    | Search                |
                    | Media metadata        |
                    | Background jobs       |
                    +------+----------+-----+
                           |          |
                           |          |
                 +---------v--+   +---v----------------+
                 | PostgreSQL |   | Discord Blob Store |
                 +------------+   +--------------------+
```

### 4.1 Control plane vs data plane

The implementation should deliberately separate:

**Control plane**

- users;
- authentication;
- MFA;
- sessions;
- file/folder metadata;
- ACL;
- collections;
- quota;
- shares;
- upload state;
- audit events;
- jobs.

**Data plane**

- incoming chunk streams;
- SHA-256 hashing;
- Discord upload/download;
- range reads;
- file reconstruction;
- ZIP streaming;
- metadata probing.

This separation keeps business authorization code understandable while allowing the streaming path to remain efficient and allocation-conscious.

## 5. Recommended backend technology choices

### 5.1 Language/runtime

- Go, current stable toolchain.
- Prefer standard library types and interfaces in domain layers.
- Avoid framework-heavy architecture.

### 5.2 HTTP

Recommended:

- `net/http` as the base;
- `chi` as a thin router if desired;
- standard middleware composition;
- no full-stack Go web framework dependency.

### 5.3 PostgreSQL

Recommended:

- `pgx/v5` and `pgxpool`;
- SQL-first repositories;
- `sqlc` is recommended for type-safe generated query bindings once schema stabilizes;
- migrations managed with a forward-only migration tool such as Goose, Atlas, or a minimal project-owned migration runner.

Do not introduce a heavy ORM unless a concrete query pattern proves SQL-first access is inadequate.

### 5.4 Logging and metrics

- `log/slog` structured logs;
- OpenTelemetry-compatible tracing hooks;
- Prometheus-compatible metrics endpoint if operational metrics are required;
- request IDs propagated through logs and audit events.

### 5.5 Password/MFA crypto

- Password hashing: Argon2id.
- TOTP secrets encrypted at rest with an application master key.
- Recovery codes stored as one-way hashes, never plaintext after enrollment response.
- Session and challenge tokens are random 256-bit values; store only SHA-256 hashes server-side.

### 5.6 MIME/media

- Primary MIME detection from content bytes.
- Filename extension is a fallback/hint, never the sole authority.
- `ffprobe` may be used as an optional external dependency for video/audio metadata.
- Image dimensions can be extracted with Go image decoders where supported.

## 6. Repository structure

Recommended initial structure:

```text
cmd/
  server/
    main.go

internal/
  app/
    app.go
    lifecycle.go

  config/
    config.go
    validate.go

  httpapi/
    router.go
    middleware.go
    errors.go
    requestid.go
    response.go

  auth/
    service.go
    password.go
    sessions.go
    handlers.go

  mfa/
    service.go
    totp.go
    recovery.go
    handlers.go

  users/
    service.go
    repository.go
    handlers.go

  drive/
    service.go
    nodes.go
    names.go
    move.go
    trash.go
    repository.go

  files/
    service.go
    repository.go
    streaming.go
    range.go
    mime.go
    metadata.go

  folders/
    service.go
    download.go

  acl/
    service.go
    folder_permissions.go
    collection_permissions.go

  collections/
    service.go
    repository.go
    handlers.go

  shares/
    service.go
    repository.go
    handlers.go

  uploads/
    service.go
    repository.go
    parts.go
    finalize.go
    handlers.go

  quota/
    service.go
    repository.go
    reconcile.go

  storage/
    blobstore.go
    discord/
      client.go
      upload.go
      download.go
      retry.go
      bots.go

  search/
    service.go
    repository.go

  jobs/
    worker.go
    repository.go
    handlers.go

  audit/
    service.go
    repository.go

  postgres/
    pool.go
    tx.go
    migrations/
    queries/

  testutil/
    postgres.go
    fakeblob.go
    factories.go

api/
  openapi.yaml

migrations/
  000001_*.sql
  ...

docs/
  BACKEND_IMPLEMENTATION_PLAN.md
  DATABASE_DESIGN.md
```

### 6.1 Layering rule

Use a pragmatic service/repository split:

```text
HTTP handler
    -> service/domain policy
        -> repository / BlobStore / job queue
```

Handlers should not contain authorization policy, SQL, quota accounting, or storage orchestration.

Repositories should not make authorization decisions.

The ACL service should be callable from every business service that needs resource authorization.

## 7. Core domain model

### 7.1 Node model

Use a unified `nodes` concept for files and folders.

A node contains hierarchy and ownership fields shared by both resource types:

- ID;
- kind: `file` or `folder`;
- owner user;
- parent folder;
- name;
- normalized name key;
- created by;
- timestamps;
- direct soft-delete fields;
- root marker.

File-specific fields live in a one-to-one `files` table.

This approach gives one namespace for files and folders and makes these operations uniform:

- create;
- rename;
- move;
- trash;
- restore;
- list children;
- breadcrumb;
- recursive tree traversal;
- name conflict enforcement.

### 7.2 User root folders

Every user receives one immutable root folder at creation.

Root rules:

- cannot be moved;
- cannot be soft-deleted;
- should normally not be renamed through the file API;
- admin can browse every user's root;
- normal users treat their root as `/`.

### 7.3 Ownership

Ownership should be predictable:

- a node created in a user's own folder is owned by that folder's owner;
- a collaborator creating/uploading into a shared folder creates content owned by the shared folder owner;
- logical quota is charged to the owner, not necessarily the actor who uploaded;
- normal users cannot transfer existing resources between ownership domains;
- cross-owner moves/ownership transfer are admin-only explicit operations;
- admin ownership transfer must perform quota validation on the destination owner.

This avoids mixed-ownership trees and makes quota/accounting understandable.

## 8. Permission model

### 8.1 Effective precedence

For folder/file resources:

```text
administrator override
        >
owner
        >
inherited folder grant
        >
no access
```

Collection access is an additional access path for files referenced by collections.

### 8.2 Folder permission levels

#### `view`

Allows:

- list visible descendants;
- read metadata;
- preview;
- download file;
- download folder;
- search within accessible subtree.

Does not allow mutations.

#### `edit`

Includes `view`, plus:

- upload/create content inside the folder;
- create subfolders;
- rename child nodes where the operation remains inside the permitted ownership domain;
- move child nodes within locations where caller has required permissions;
- soft-delete child nodes;
- restore child nodes where caller has authority;
- update non-security metadata.

Does not allow:

- changing folder ACL;
- changing public-share state of the folder itself unless product policy later explicitly allows it;
- ownership transfer.

#### `full`

Includes `edit`, plus:

- manage folder grants;
- create/revoke public share for the folder;
- manage structural operations on the folder itself, subject to owner/root protections.

### 8.3 Folder inheritance

Folder grants inherit to descendants.

Example:

```text
Projects/          Bob=edit
  Backend/
    spec.pdf
```

Bob gets effective `edit` on `Backend` and `spec.pdf` unless a future explicit-deny feature is added. V1 has no deny semantics.

### 8.4 Collection permission semantics

Collections are logical groupings, not filesystem containers.

Recommended V1 semantics:

- `view`: see collection and preview/download active files in the collection;
- `edit`: `view` plus change collection metadata and add/remove items when the caller is allowed to reference those items;
- `full`: `edit` plus manage collection ACL and public share state.

A collection grant should **not** silently grant structural ownership operations on the original file's folder. For example, `edit` on a collection should not allow moving the underlying file out of its owner's folder unless the caller also has appropriate folder authority.

This prevents a collection share from becoming an unexpected filesystem privilege escalation.

### 8.5 Authorization service

All resource services should call a centralized API resembling:

```go
CanViewNode(ctx, actor, nodeID)
CanEditNode(ctx, actor, nodeID)
CanManageNode(ctx, actor, nodeID)
CanCreateChild(ctx, actor, folderID)
CanViewCollection(ctx, actor, collectionID)
CanEditCollection(ctx, actor, collectionID)
CanManageCollection(ctx, actor, collectionID)
```

Do not copy ACL resolution logic into handlers.

## 9. Soft-delete and Trash semantics

### 9.1 No permanent-delete API

There is no endpoint that permanently deletes a committed file or folder.

There is no "Empty Trash" operation.

Committed resources remain restorable indefinitely.

### 9.2 Direct vs effective deletion

Each node has direct deletion state:

```text
deleted_at = NULL     -> node was not directly trashed
deleted_at != NULL    -> node was directly trashed
```

A node is **effectively deleted** when:

- it is directly deleted; or
- any ancestor folder is directly deleted.

This distinction is essential.

Example:

```text
A/                 deleted_at != NULL
  B/               deleted_at = NULL
    file.txt       deleted_at = NULL
```

`B` and `file.txt` are effectively deleted without rewriting every descendant row.

### 9.3 Trash listing

Trash should primarily list direct deletion roots.

If a folder is trashed, the UI/API does not need to list every descendant separately.

If a child had already been directly trashed before its parent was trashed, that child retains its own `deleted_at`. Restoring the parent does not implicitly restore the child.

### 9.4 Restore

Restore clears the target node's direct `deleted_at` and `deleted_by` fields.

Restore must validate:

- parent is active or a new destination is supplied;
- destination naming conflict;
- actor permission;
- ownership rules;
- quota impact;
- root invariants;
- folder cycle rules.

If the original parent is not active, API supports restore-to another active folder.

### 9.5 Share behavior on delete

When a node or collection is trashed:

- all active public shares rooted at that resource are revoked;
- direct public shares to descendants should also be revoked when deleting a folder subtree for privacy;
- restore does not reactivate old public links;
- user must generate a new public link.

Internal ACL rows remain stored so restore preserves internal access configuration.

### 9.6 Physical storage behavior

Soft-delete never removes committed Discord chunks.

Consequences:

- restore is always possible;
- deleted files can still contribute chunks to deduplication of later uploads;
- logical quota can decrease while physical Discord usage does not;
- physical storage grows monotonically for committed data.

This is an intentional product tradeoff under the "no permanent delete" requirement.

## 10. Quota model

### 10.1 Logical accounting

For each owner:

```text
used_bytes = sum(size of owned files that are effectively active)
reserved_bytes = bytes reserved by open upload sessions
quota_bytes = NULL means unlimited
```

Finite quota check:

```text
used_bytes + reserved_bytes + requested_delta <= quota_bytes
```

### 10.2 Deduplication and quota

Deduplication changes physical storage, not logical accounting.

If two users each own a 5 GiB logical file with identical content:

- physical chunks may occupy only 5 GiB;
- user A consumes 5 GiB quota;
- user B consumes 5 GiB quota.

### 10.3 Quota reservation

Create an upload session only after reserving its full logical size.

On session creation:

1. lock owner quota row;
2. verify quota;
3. increment `storage_reserved_bytes`;
4. insert upload session.

On successful finalize:

1. decrement reservation;
2. increment used bytes;
3. create committed file;
4. mark upload completed.

On cancel/expiry:

- decrement reservation;
- mark upload closed.

### 10.4 Soft-delete accounting

Deleting a file:

- decrement owner used bytes by file size immediately.

Deleting a folder:

- recursively determine currently active descendant files;
- exclude descendants already effectively deleted by a directly deleted nested subtree;
- group bytes by owner if admin-only cross-owner trees ever exist;
- decrement relevant owner counters transactionally;
- mark only the deletion root as directly deleted.

### 10.5 Restore accounting

Restoring a file/folder:

- calculate the active bytes that would become visible again;
- check destination owner's quota;
- increment usage if allowed;
- clear direct deletion marker.

If restore exceeds finite quota:

- normal user receives quota error;
- admin can raise quota and retry;
- optionally expose an explicit admin `force` mode that permits an over-quota state, but do not make force implicit.

### 10.6 Reconciliation

`storage_used_bytes` and `storage_reserved_bytes` are maintained counters, not the sole truth.

Provide periodic/administrative reconciliation that recomputes:

- logical active used bytes from nodes/files;
- active reservation bytes from upload sessions.

Differences are logged and corrected in a transaction.

## 11. Move, rename, copy, and hierarchy rules

### 11.1 Rename

Rename is a node metadata update.

Validation:

- valid UTF-8;
- normalized Unicode;
- no `/`, NUL, `.` or `..` special path names;
- bounded length;
- no active sibling name conflict after normalization/case folding.

### 11.2 Move

Move updates `parent_id` while preserving the node ID.

Required checks:

- actor can mutate source;
- actor can create in destination;
- source/destination active;
- no cycle for folder moves;
- no root move;
- no name conflict;
- same-owner for normal users;
- quota/ownership transfer rules for admin cross-owner move.

### 11.3 Folder cycle detection

Reject:

```text
A/
  B/
```

when attempting to move `A` under `B`.

Use a recursive ancestor/descendant query within the transaction.

### 11.4 Copy

Copy is a separate operation from move.

File copy:

- creates a new node and file row;
- reuses existing file chunk references;
- no Discord re-upload;
- consumes full logical quota for destination owner.

Folder copy can be added after core move/restore behavior is stable. If implemented, it recursively creates new nodes and reuses file chunks.

## 12. API conventions

### 12.1 Version prefix

All authenticated/public JSON APIs use:

```text
/api/v1
```

Public share pages/content may use `/s/{publicId}` outside the versioned JSON namespace.

### 12.2 JSON naming

Use camelCase consistently.

### 12.3 IDs

Use UUIDv7 for internal IDs generated by the Go application.

Public share identifiers are separate high-entropy opaque strings suitable for URLs.

### 12.4 Error format

Use RFC 9457-style `application/problem+json`.

Example:

```json
{
  "type": "https://discloud.local/problems/quota-exceeded",
  "title": "Storage quota exceeded",
  "status": 409,
  "code": "quota_exceeded",
  "detail": "Restoring this folder would exceed the user's storage quota.",
  "requestId": "...",
  "meta": {
    "requiredBytes": 5368709120,
    "availableBytes": 2147483648
  }
}
```

### 12.5 Pagination

Prefer cursor pagination for large lists/search results.

Cursor should encode stable sort keys such as:

```text
(created_at, id)
```

Offset pagination may be accepted for small admin lists, but drive/file listings should not depend on large offsets.

### 12.6 Concurrency

Mutation endpoints should:

- lock affected rows when structural consistency matters;
- return `409 Conflict` for naming/move conflicts;
- support idempotent upload finalize;
- use request IDs for tracing.

## 13. Proposed API surface

The exact OpenAPI file is a later deliverable, but implementation should converge on the following structure.

### 13.1 Setup

```http
GET  /api/v1/setup/status
POST /api/v1/setup
```

`POST /setup` succeeds only when no user exists. Use a PostgreSQL advisory lock or equivalent serializable guard to prevent two concurrent first-admin creations.

### 13.2 Authentication

```http
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

If password is correct and MFA is disabled, login creates a session.

If MFA is enabled, login returns a short-lived MFA challenge rather than a full authenticated session.

```http
POST /api/v1/auth/mfa/verify
```

### 13.3 Current account

```http
GET    /api/v1/me
PATCH  /api/v1/me
PUT    /api/v1/me/password
GET    /api/v1/me/sessions
DELETE /api/v1/me/sessions/{sessionId}
POST   /api/v1/me/sessions/revoke-others
```

### 13.4 MFA

```http
POST   /api/v1/me/mfa/totp/enroll
POST   /api/v1/me/mfa/totp/confirm
DELETE /api/v1/me/mfa/totp
POST   /api/v1/me/mfa/recovery-codes/regenerate
```

Admin reset:

```http
DELETE /api/v1/admin/users/{userId}/mfa
```

### 13.5 Admin users

```http
GET   /api/v1/admin/users
POST  /api/v1/admin/users
GET   /api/v1/admin/users/{userId}
PATCH /api/v1/admin/users/{userId}

PUT   /api/v1/admin/users/{userId}/quota
POST  /api/v1/admin/users/{userId}/reset-password
POST  /api/v1/admin/users/{userId}/disable
POST  /api/v1/admin/users/{userId}/enable
GET   /api/v1/admin/users/{userId}/usage
GET   /api/v1/admin/users/{userId}/root
```

Do not implement hard-delete of users in the first release. Disable accounts instead.

### 13.6 Folder/node browsing

```http
GET   /api/v1/folders/{folderId}
GET   /api/v1/folders/{folderId}/children
POST  /api/v1/folders
PATCH /api/v1/folders/{folderId}
DELETE /api/v1/folders/{folderId}
POST  /api/v1/folders/{folderId}/restore
GET   /api/v1/folders/{folderId}/download
```

`DELETE` means soft-delete.

`PATCH` handles rename and move.

### 13.7 Files

```http
GET    /api/v1/files/{fileId}
PATCH  /api/v1/files/{fileId}
DELETE /api/v1/files/{fileId}
POST   /api/v1/files/{fileId}/restore
GET    /api/v1/files/{fileId}/content
GET    /api/v1/files/{fileId}/download
```

`content` supports inline preview and Range requests.

`download` forces attachment disposition.

### 13.8 Batch operations

```http
POST /api/v1/batch/move
POST /api/v1/batch/trash
POST /api/v1/batch/restore
GET  /api/v1/batch/download
```

Batch endpoints must remain transactional where semantics require all-or-nothing; large archive download is naturally streaming and not a DB transaction.

### 13.9 Trash

```http
GET /api/v1/trash
```

No permanent-delete and no empty-trash endpoints exist.

### 13.10 Upload sessions

```http
POST   /api/v1/uploads
GET    /api/v1/uploads/{uploadId}
DELETE /api/v1/uploads/{uploadId}
PUT    /api/v1/uploads/{uploadId}/parts/{partIndex}
POST   /api/v1/uploads/{uploadId}/complete
```

Optional optimization:

```http
POST /api/v1/uploads/{uploadId}/parts/check
```

for bulk hash existence checks.

### 13.11 Folder upload orchestration

The core backend does not need a special filesystem-upload protocol to preserve folder trees. A client can:

1. batch-create/resolve folders;
2. create one upload session per file;
3. upload chunks concurrently.

To make future web folder uploads efficient, add:

```http
POST /api/v1/folders/batch
```

Input describes a bounded folder tree with client temporary IDs. Response maps temporary IDs to server folder IDs.

Do not make the first implementation depend on a giant all-files manifest that must fit in one request.

### 13.12 Folder grants

```http
GET    /api/v1/folders/{folderId}/access
PUT    /api/v1/folders/{folderId}/access/{userId}
DELETE /api/v1/folders/{folderId}/access/{userId}
```

Payload:

```json
{
  "level": "edit"
}
```

Only owner, admin, or effective `full` manager may mutate ACL.

### 13.13 Collections

```http
GET    /api/v1/collections
POST   /api/v1/collections
GET    /api/v1/collections/{collectionId}
PATCH  /api/v1/collections/{collectionId}
DELETE /api/v1/collections/{collectionId}
POST   /api/v1/collections/{collectionId}/restore

GET    /api/v1/collections/{collectionId}/items
POST   /api/v1/collections/{collectionId}/items
DELETE /api/v1/collections/{collectionId}/items/{fileId}
```

Collection access:

```http
GET    /api/v1/collections/{collectionId}/access
PUT    /api/v1/collections/{collectionId}/access/{userId}
DELETE /api/v1/collections/{collectionId}/access/{userId}
```

### 13.14 Public shares

Create a generic share resource:

```http
POST   /api/v1/shares
DELETE /api/v1/shares/{shareId}
```

Create payload:

```json
{
  "resourceType": "file",
  "resourceId": "..."
}
```

Public resolver:

```http
GET /s/{publicId}
```

For JSON clients, an internal resolver may expose:

```http
GET /api/v1/public/shares/{publicId}
```

and content endpoints derived from that share context.

### 13.15 Search

```http
GET /api/v1/search?q=...
```

Filters can include:

- `kind=file|folder`;
- `mimeType`;
- `category`;
- `ownerId` for admin;
- `folderId` subtree;
- `collectionId`;
- `favorite`;
- `shared`;
- size range;
- created/updated range;
- active/trash state for admin.

Search must be authorization-aware in SQL/service logic, not filtered only in the client.

### 13.16 Admin/system

```http
GET /api/v1/admin/overview
GET /api/v1/admin/storage
GET /api/v1/admin/jobs
GET /api/v1/admin/audit

GET /healthz
GET /readyz
```

## 14. Upload subsystem

### 14.1 Goals

- large files;
- resumable transfer;
- no full-file buffering;
- chunk SHA verification;
- global dedupe;
- quota reservation;
- retry-safe part submission;
- controlled Discord concurrency;
- consistent finalization.

### 14.2 Session creation

Client sends:

```json
{
  "parentFolderId": "...",
  "name": "movie.mkv",
  "size": 7340032000,
  "mimeTypeHint": "video/x-matroska",
  "fileSha256": null
}
```

Server:

1. validates destination and permission;
2. determines owner from destination folder;
3. checks normalized-name conflict policy;
4. reserves logical quota;
5. selects server chunk size;
6. creates upload session;
7. returns chunk size and session ID.

### 14.3 Part upload

```http
PUT /api/v1/uploads/{uploadId}/parts/{partIndex}
```

Headers may include expected SHA-256.

Server:

1. validates index and expected length;
2. streams request body through SHA-256 hasher;
3. rejects hash mismatch;
4. checks global `chunks` table by hash + size;
5. if chunk exists and is committed/usable, link it to upload part without Discord re-upload;
6. otherwise upload once to Discord;
7. insert or reuse chunk row;
8. persist upload-part reference;
9. make retry idempotent.

### 14.4 Concurrency and dedupe race

Two uploads may concurrently upload the same previously unseen chunk.

Handle with one of:

- PostgreSQL advisory lock derived from chunk hash; or
- unique chunk hash constraint plus upload winner/loser reconciliation.

Preferred first implementation: advisory lock for the small critical section around chunk existence + Discord upload registration, while not holding a database transaction open across long network I/O unnecessarily.

A robust flow:

1. acquire application-level keyed lock/advisory lock;
2. re-check chunk;
3. if absent, perform Discord upload;
4. insert chunk metadata;
5. release lock.

If process dies after Discord upload but before DB insert, technical orphan cleanup tooling should detect orphan messages where possible; at minimum log enough context for operator diagnostics.

### 14.5 Finalize

Finalize is idempotent.

Validation:

- all expected parts present;
- aggregate size matches session size;
- optional full-file SHA can be derived from streamed parts if available/needed;
- destination still active;
- owner quota reservation still valid;
- no naming conflict appeared meanwhile.

Transaction:

1. lock upload session;
2. create node;
3. create file row;
4. copy upload part references into committed file-chunk rows;
5. mark upload complete;
6. convert reserved quota to used quota;
7. enqueue MIME/media metadata job;
8. write audit event;
9. commit.

### 14.6 Upload cancellation/expiry

Cancellation/technical expiry:

- releases reserved quota;
- closes session;
- does not affect already committed files;
- uploaded chunks that remain globally referenced are retained;
- truly unreferenced uncommitted chunks may be cleaned by technical orphan GC.

Upload-session TTL is not file retention.

## 15. File download and media streaming

### 15.1 File reconstruction

A file is reconstructed from ordered chunk references.

Implement an abstraction that can expose:

- sequential `io.Reader`;
- bounded byte range reader;
- known total size.

Do not buffer the entire file.

### 15.2 HTTP headers

Content endpoint should return:

- canonical `Content-Type`;
- `Content-Length` for full response;
- `Accept-Ranges: bytes`;
- `ETag` based on immutable content hash when available;
- safe `Content-Disposition`;
- `X-Content-Type-Options: nosniff` where appropriate.

### 15.3 Range support

Support single byte ranges in V1.

Map requested byte range to affected chunks and request only needed byte spans from Discord/CDN when possible.

Return:

- `206 Partial Content`;
- `Content-Range`;
- accurate content length.

Reject unsatisfiable ranges with `416`.

### 15.4 Inline vs download

`/content` uses an inline disposition where safe.

`/download` forces attachment disposition.

The backend should not infer preview capability from extension alone.

## 16. Folder download

### 16.1 Streaming archive

`GET /folders/{id}/download` streams a ZIP archive.

Pipeline:

```text
DB tree traversal
    -> ACL validation
    -> ordered file iteration
    -> reconstruct each file stream
    -> ZIP writer
    -> HTTP response
```

Do not create a temporary ZIP equal to folder size before sending.

### 16.2 Archive naming

- preserve folder hierarchy;
- sanitize archive paths;
- reject traversal sequences;
- preserve UTF-8 names where possible;
- handle duplicate archive paths deterministically.

### 16.3 Deleted nodes

Folder download excludes effectively deleted descendants.

### 16.4 Large folder behavior

- start response only after authorization/tree validation sufficient to avoid partial security failures;
- still avoid loading all file bytes;
- tree metadata may be streamed/paged internally if extremely large;
- cancel downstream Discord requests when client disconnects.

## 17. Public sharing

### 17.1 Share identifiers

Public IDs must be unguessable.

Recommended:

- at least 128 bits of cryptographic entropy;
- URL-safe base64/base58 encoding;
- unique index.

Although this is not called an "access token," the URL acts as a public bearer capability and must not be sequential.

### 17.2 Share authorization

Creating/revoking share requires:

- admin; or
- owner; or
- effective `full` permission on the folder/collection.

### 17.3 Public file share

Allows:

- metadata needed for public view;
- inline content;
- download.

### 17.4 Public folder share

Allows:

- browse active descendants;
- file preview/download;
- folder ZIP download.

Never exposes unrelated ancestors or siblings.

### 17.5 Public collection share

Allows:

- list active collection items;
- preview/download included files.

### 17.6 Revocation

Revocation is immediate at DB level.

CDN URLs must not be permanently exposed in a way that bypasses share revocation. Prefer proxying public content through backend authorization or using only short-lived CDN locations when unavoidable.

## 18. Collections

Collections are many-to-many logical groupings of files.

Properties:

- owner;
- name;
- description;
- timestamps;
- soft-delete;
- members;
- ACL;
- optional public share.

A file can belong to many collections without duplicating file bytes or logical quota.

Collection membership of a soft-deleted file is retained so restore reconstructs prior organization automatically.

## 19. Search and listing

### 19.1 Authorization-aware queries

Never fetch all results and filter permissions in Go for large listings.

Queries should include ownership/admin/ACL visibility constraints as early as practical.

### 19.2 Name search

Use PostgreSQL trigram indexes for fuzzy filename/folder search.

Future full-text extraction can be layered separately.

### 19.3 Common filters

- node kind;
- MIME type;
- category;
- owner;
- folder subtree;
- collection;
- favorite;
- shared state;
- date range;
- size range;
- active/trash.

### 19.4 Sorts

At minimum:

- name;
- size for files;
- created time;
- updated time;
- MIME/category.

Use deterministic secondary sort by ID.

## 20. MIME and media metadata

### 20.1 Canonical MIME

During/after upload:

1. inspect first content bytes;
2. derive MIME;
3. compare to client hint;
4. use extension only as fallback;
5. persist canonical MIME and category.

### 20.2 Categories

Recommended normalized categories:

- `image`;
- `video`;
- `audio`;
- `document`;
- `text`;
- `archive`;
- `application`;
- `binary`;
- `other`.

### 20.3 Metadata jobs

After commit, enqueue media metadata extraction.

Examples:

- image width/height;
- EXIF summary;
- video duration/resolution/codecs/bitrate;
- audio duration/codecs/tags/artwork presence;
- PDF page count if later needed.

Metadata extraction failure must never make the original file unusable.

### 20.4 Derived preview assets

Backend schema may support thumbnails/posters later.

Derived assets:

- are not charged to user logical quota;
- are reproducible;
- must never replace canonical original data;
- can be regenerated if missing.

Do not block core file storage release on transcoding.

## 21. Authentication and security

### 21.1 Password policy

Initial baseline:

- minimum 10-12 characters;
- no forced periodic rotation;
- Argon2id;
- reject obviously invalid empty/whitespace usernames;
- username is case-insensitively unique while preserving display casing.

### 21.2 Sessions

- random 256-bit session secret in cookie;
- store SHA-256 hash server-side;
- HttpOnly;
- Secure in HTTPS mode;
- SameSite=Lax or stricter depending deployment;
- configurable session TTL;
- revoke current/all-other sessions;
- disabling user revokes sessions.

### 21.3 MFA login

Password success with MFA enabled creates a short-lived MFA challenge, not a normal session.

TOTP/recovery verification consumes challenge and then issues real session.

### 21.4 MFA recovery codes

- generate a fixed set, e.g. 10 one-time codes;
- show plaintext once;
- store hashes only;
- each code can be consumed once;
- regeneration invalidates unused previous codes.

### 21.5 CSRF

Since web auth is cookie-based:

- validate `Origin`/`Referer` on unsafe methods;
- use appropriate SameSite cookies;
- optionally add a CSRF token if deployment/client architecture requires it.

Do not rely on "only admin/user uses it" as a reason to skip CSRF.

### 21.6 CORS

- same-origin web deployment by default;
- explicit allowlist only;
- no wildcard credentialed CORS.

### 21.7 No application rate limit

Do not implement the legacy upload/download/auth quota/rate-limit system.

Still enforce technical safety:

- request body bounds;
- maximum metadata lengths;
- upload worker concurrency;
- Discord request concurrency;
- DB pool sizing;
- archive/path safety;
- context cancellation/timeouts.

## 22. Discord blob storage abstraction

### 22.1 Interface

Create a minimal internal interface, for example:

```go
type BlobStore interface {
    PutChunk(ctx context.Context, r io.Reader, size int64, sha256 [32]byte) (ChunkLocation, error)
    OpenChunk(ctx context.Context, loc ChunkLocation, offset, length int64) (io.ReadCloser, error)
}
```

No production local filesystem backend is required.

A fake in-memory implementation is useful for tests.

### 22.2 Bot identity

Each stored chunk records which configured Discord bot/storage identity created the message so download/recovery remains deterministic.

### 22.3 Retry policy

Retry only retryable network/Discord conditions.

Use bounded exponential backoff with jitter and respect Discord rate-limit responses.

Application-level rate limiting is removed, but upstream Discord rate limits still exist and must be handled correctly.

### 22.4 Multiple bots

Support multiple configured bots/storage identities.

Selection can start with round-robin or least-inflight strategy.

Do not let bot selection affect chunk identity/dedupe semantics.

## 23. Background jobs

Use PostgreSQL as the first job queue instead of adding Redis/Valkey.

Worker claims jobs using `FOR UPDATE SKIP LOCKED`.

Initial job types:

- MIME/media metadata extraction;
- upload-session expiry cleanup;
- orphan uncommitted chunk cleanup;
- quota reconciliation;
- optional derived preview generation;
- optional audit retention/maintenance if ever needed.

Committed soft-deleted file blobs are never GC candidates.

## 24. Configuration

Environment/config baseline:

- HTTP listen address;
- public base URL;
- PostgreSQL DSN;
- session cookie settings;
- application master encryption key;
- Discord guild/channel configuration;
- Discord bot identities/tokens;
- upload chunk size;
- max concurrent Discord uploads/downloads;
- session TTL;
- upload session TTL;
- job worker count;
- trusted proxy configuration;
- allowed CORS origins if separate web origin is used;
- log level.

Secrets should not be logged.

If runtime-editable secret configuration is added later, secrets must be encrypted at rest.

## 25. Observability and audit

### 25.1 Structured logging

Every request log includes:

- request ID;
- method;
- route template;
- status;
- duration;
- actor user ID when known;
- bytes in/out where useful.

Do not log:

- passwords;
- session secrets;
- MFA secrets;
- recovery code plaintext;
- Discord bot tokens;
- share public IDs in security-sensitive log contexts unless necessary.

### 25.2 Audit events

Audit important state changes:

- setup completed;
- login/logout and MFA changes;
- admin user create/disable/enable;
- quota changes;
- node move/rename/trash/restore;
- ownership transfer;
- ACL changes;
- collection ACL changes;
- public share create/revoke;
- admin password/MFA reset.

Audit log is append-only from application perspective.

### 25.3 Health

`/healthz`:

- process alive.

`/readyz`:

- PostgreSQL reachable;
- required migrations applied;
- required Discord configuration loaded;
- optionally lightweight Discord readiness without causing excessive upstream traffic.

## 26. Transaction boundaries

Operations that must be atomic in PostgreSQL include:

- first-admin setup;
- create user + root folder;
- upload session reserve quota;
- upload finalize;
- rename/move with name-conflict validation;
- soft-delete + quota release + share revocation;
- restore + quota consume;
- quota update;
- ownership transfer;
- ACL change;
- collection membership change where authorization depends on current state.

Do not keep DB transactions open while streaming large request/response bodies or waiting on long Discord network operations unless unavoidable.

## 27. Testing strategy

### 27.1 Unit tests

Focus on pure domain policy:

- permission precedence;
- name normalization;
- quota calculations;
- range parser;
- move cycle logic helpers;
- MIME categorization;
- share state rules;
- restore semantics.

### 27.2 PostgreSQL integration tests

Run real PostgreSQL in tests/CI.

Cover:

- migrations from empty DB;
- unique username;
- root invariants;
- active sibling name uniqueness;
- recursive tree queries;
- ACL inheritance;
- soft-delete effective state;
- quota counters;
- concurrent reservations;
- restore conflicts;
- public share revocation;
- collection permissions;
- job claim concurrency.

### 27.3 HTTP contract tests

Test:

- status codes;
- problem JSON body;
- auth cookie lifecycle;
- MFA challenge;
- permission matrix;
- upload state machine;
- Range responses;
- folder ZIP;
- public share paths;
- trash/restore.

### 27.4 Storage tests

Use fake BlobStore for deterministic tests.

Optional live Discord integration suite runs only with explicit CI secret/environment flag.

### 27.5 Concurrency tests

Critical cases:

- two simultaneous first-admin setup calls;
- concurrent same-name create;
- concurrent quota reservations;
- same chunk uploaded concurrently;
- move vs delete race;
- restore vs new conflicting name;
- duplicate upload finalize.

### 27.6 Fuzz tests

Good fuzz targets:

- Range header parser;
- archive path sanitizer;
- filename normalization;
- MIME fallback parser;
- share public ID decoder;
- cursor decoder.

### 27.7 Load tests

Before backend v1 release:

- many concurrent small file uploads;
- several concurrent large file uploads;
- Range-heavy video reads;
- large folder listing;
- folder ZIP streaming;
- permission-heavy search;
- user with large trash tree.

## 28. Implementation phases

The phases below are ordered to minimize rework. Each phase has a concrete exit gate.

---

### Phase 0 — New backend bootstrap

#### Deliverables

- new Go module/project skeleton;
- configuration loader;
- structured logging;
- HTTP server lifecycle;
- graceful shutdown;
- PostgreSQL connection pool;
- migration runner;
- health/readiness endpoints;
- CI running format/vet/test;
- base Dockerfile.

#### Exit criteria

- empty server boots with PostgreSQL;
- migrations apply automatically or through documented command;
- `/healthz` and `/readyz` work;
- SIGTERM drains server cleanly;
- no SQLite, CLI, Valkey, or legacy compatibility package exists.

---

### Phase 1 — Database foundation and shared primitives

#### Deliverables

- UUIDv7 helper;
- transaction helper;
- problem JSON errors;
- request IDs;
- common pagination/cursor helper;
- audit event primitive;
- job queue primitive;
- database schema through users/nodes skeleton.

#### Exit criteria

- migration test from empty DB passes;
- tx helper proven by integration test;
- standardized errors used by all new handlers.

---

### Phase 2 — Setup, password auth, sessions

#### Deliverables

- `GET /setup/status`;
- atomic `POST /setup`;
- Argon2id password hashing;
- login/logout;
- current-account endpoint;
- session cookies;
- session revoke/list;
- username update;
- password update;
- user disable check in auth middleware.

#### Exit criteria

- exactly one concurrent setup wins;
- disabled users cannot authenticate;
- logout invalidates session server-side;
- password change can revoke other sessions.

---

### Phase 3 — Optional TOTP MFA

#### Deliverables

- TOTP enrollment;
- QR provisioning URI data in API;
- TOTP confirmation;
- MFA login challenge;
- recovery codes;
- recovery code regeneration;
- MFA disable;
- admin reset MFA.

#### Exit criteria

- MFA user cannot obtain full session with password alone;
- recovery code is one-time;
- secret encrypted at rest;
- no plaintext recovery code remains in DB/logs.

---

### Phase 4 — Admin user management and quota counters

#### Deliverables

- create user + root folder transaction;
- user list/detail;
- enable/disable;
- admin reset password;
- quota update;
- usage endpoint;
- admin override middleware/policy.

#### Exit criteria

- new user gets root folder;
- default quota is unlimited;
- finite quota persists correctly;
- disabled account sessions are revoked.

---

### Phase 5 — Node tree: folders, rename, move

#### Deliverables

- create folder;
- list children;
- breadcrumbs/ancestor query;
- rename;
- move;
- normalized name conflict enforcement;
- root protections;
- cycle detection;
- admin cross-owner move/transfer design implemented or explicitly deferred behind a safe error.

#### Exit criteria

- arbitrary-depth tree works;
- cannot create cycle;
- cannot move/delete root;
- duplicate active sibling name rejected;
- transaction race tests pass.

---

### Phase 6 — Folder ACL

#### Deliverables

- folder grant CRUD;
- `view/edit/full` model;
- inherited resolution;
- owner/admin precedence;
- permission-aware child listing;
- permission-aware node lookup;
- audit events for grants.

#### Exit criteria

- comprehensive ACL matrix tests pass;
- unauthorized resources are not leaked through list/search/detail endpoints;
- admin bypass works consistently.

---

### Phase 7 — Discord BlobStore and chunk model

#### Deliverables

- Discord client abstraction;
- multi-bot configuration;
- chunk upload;
- chunk range read;
- retry/rate-limit handling for upstream Discord;
- chunk DB registration;
- fake BlobStore for tests.

#### Exit criteria

- chunk round-trip succeeds;
- failure/retry behavior tested;
- no full-chunk unnecessary copies where streaming is possible.

---

### Phase 8 — Upload sessions, resumable parts, dedupe

#### Deliverables

- upload session create;
- quota reservation;
- part upload;
- chunk hash verification;
- chunk dedupe;
- part retry idempotency;
- upload completion;
- cancel;
- technical expiry cleanup;
- quota reservation release.

#### Exit criteria

- interrupted upload can resume;
- duplicate part retry does not duplicate state;
- identical chunk concurrent race handled;
- completed upload creates one committed logical file;
- quota counter transitions are correct.

---

### Phase 9 — File streaming and Range

#### Deliverables

- file metadata API;
- full content streaming;
- download disposition;
- Range parser;
- cross-chunk range reconstruction;
- ETag/content headers;
- cancellation propagation.

#### Exit criteria

- large file download does not scale memory with file size;
- media seek works through standard HTTP Range tests;
- malformed/unsatisfiable Range handled correctly.

---

### Phase 10 — Folder upload support and folder download

#### Deliverables

- batch folder create endpoint;
- folder-tree upload orchestration contract;
- recursive folder ZIP stream;
- multi-file batch download as archive if desired;
- archive path sanitizer.

#### Exit criteria

- nested local folder tree can be recreated through API;
- nested server folder downloads as correct ZIP;
- no prebuilding entire archive on disk required.

---

### Phase 11 — Soft-delete, Trash, restore, quota release

#### Deliverables

- file trash;
- folder trash;
- effective deletion query;
- trash listing;
- file restore;
- folder restore;
- restore-to destination;
- quota release on delete;
- quota consume on restore;
- public share revocation on trash;
- no permanent-delete routes.

#### Exit criteria

- deleting folder does not rewrite every descendant row;
- nested directly-deleted child remains deleted after parent restore;
- quota releases immediately;
- restore fails safely on quota/name conflict;
- committed blobs remain intact.

---

### Phase 12 — Collections and collection ACL

#### Deliverables

- collection create/update/trash/restore;
- collection item membership;
- `view/edit/full` grants;
- collection visibility queries;
- soft-deleted file membership retention.

#### Exit criteria

- user can access a file through collection view without gaining parent-folder traversal;
- collection edit/full cannot accidentally bypass folder structural rules;
- restore preserves collection organization.

---

### Phase 13 — Public shares

#### Deliverables

- generic share create/revoke;
- high-entropy public IDs;
- file public access;
- folder public browsing/download;
- collection public access;
- deleted-resource hard block;
- share revocation on trash.

#### Exit criteria

- no auth/password/token required for valid share URL;
- revoked URL stops immediately;
- deleted resource never resolves publicly;
- public endpoint cannot escape shared subtree/collection.

---

### Phase 14 — Search, filters, favorites

#### Deliverables

- fuzzy name search with trigram support;
- permission-aware search;
- filters/sorts;
- favorite flag;
- admin owner filters;
- active/trash filters.

#### Exit criteria

- no unauthorized search leakage;
- index plans remain acceptable on representative large dataset;
- cursor pagination stable.

---

### Phase 15 — MIME and media metadata backend

#### Deliverables

- canonical MIME persistence;
- category mapping;
- metadata extraction job;
- image dimensions;
- optional ffprobe video/audio fields;
- metadata status/error fields;
- APIs expose metadata needed by future rich previews.

#### Exit criteria

- arbitrary file type can still upload even if probe fails;
- video/audio metadata failure never breaks download;
- MIME no longer depends only on filename extension.

---

### Phase 16 — Operational hardening

#### Deliverables

- audit query API;
- admin storage overview;
- quota reconciliation;
- orphan upload cleanup;
- job retry/dead state;
- metrics;
- trace hooks;
- security headers;
- config validation;
- backup/restore documentation for PostgreSQL.

#### Exit criteria

- operator can diagnose failed uploads/jobs;
- quota counters can be reconciled;
- readiness accurately represents startup dependencies.

---

### Phase 17 — Full backend stabilization

#### Deliverables

- OpenAPI spec complete;
- generated/validated API examples;
- load tests;
- fuzz tests;
- migration review;
- threat-model review;
- all backend docs;
- release checklist.

#### Exit criteria

- backend can be used by a future web client without requiring domain redesign;
- API has stable versioned contracts;
- all high-risk concurrency/ACL/quota/restore cases are covered by automated tests.

## 29. Suggested milestone sequence

For practical delivery, group phases into milestones:

### Milestone A — Identity foundation

Phases 0-4.

Result: deployable server with PostgreSQL, setup, users, sessions, MFA, quotas.

### Milestone B — Drive foundation

Phases 5-6.

Result: folder tree and ACL work before file bytes are introduced.

### Milestone C — Storage engine

Phases 7-10.

Result: upload/download/folder transfer works with Discord-backed chunks.

### Milestone D — Lifecycle and sharing

Phases 11-13.

Result: trash/restore, collections, internal/public sharing complete.

### Milestone E — Discovery and media metadata

Phases 14-15.

Result: backend exposes the capabilities needed for a rich file manager/gallery.

### Milestone F — Production hardening

Phases 16-17.

Result: backend is ready to freeze v1 API and begin web-app implementation.

## 30. Risk register

### 30.1 Discord as blob storage

Risks:

- upstream API behavior/rate limits;
- attachment URL lifetime;
- account/bot/channel availability;
- message deletion outside application;
- upload size constraints.

Mitigation:

- persistent message/attachment IDs;
- retry logic;
- integrity verification;
- readiness/diagnostics;
- multiple bots;
- never treat ephemeral CDN URL as canonical location.

### 30.2 No permanent deletion

Risk:

- physical storage only grows.

Mitigation:

- make this explicit in admin storage reporting;
- distinguish logical active usage vs physical unique chunk usage;
- only technical orphan GC is allowed;
- future permanent deletion requires a deliberate product change and migration, not an accidental endpoint.

### 30.3 ACL complexity

Risk:

- authorization leaks through alternate endpoints.

Mitigation:

- central ACL service;
- permission-aware SQL;
- exhaustive matrix tests;
- admin bypass implemented centrally;
- public-share resolver isolated from normal auth paths.

### 30.4 Quota races

Risk:

- concurrent uploads exceed finite quota.

Mitigation:

- row lock quota owner;
- explicit reservation bytes;
- transactional counter updates;
- reconciliation job.

### 30.5 Recursive folder operations

Risk:

- large subtree move/delete/restore becomes expensive.

Mitigation:

- adjacency list + indexed parent IDs first;
- recursive CTEs;
- avoid descendant updates for folder soft-delete;
- benchmark before adding closure table/materialized path complexity.

### 30.6 Collection privilege ambiguity

Risk:

- edit access through collection unexpectedly mutates owner filesystem.

Mitigation:

- keep collection structural permissions separate from folder structural permissions;
- document exact capability matrix;
- test every operation with collection-only access.

## 31. Backend definition of done

The backend is considered feature-complete for the first web-app integration only when all of the following are true:

- clean setup on empty PostgreSQL;
- admin bootstrap is race-safe;
- admin can create/disable users and set quotas;
- password login/logout/session management works;
- optional TOTP MFA and recovery work;
- users have root folders;
- folder create/list/rename/move works;
- folder ACL inheritance works;
- admin override works everywhere;
- file upload is resumable and chunk-deduplicated;
- quota reservation prevents concurrent overrun;
- file download and Range streaming work;
- nested folder upload is representable through API;
- folder ZIP download streams;
- soft-delete releases quota;
- restore consumes quota and preserves data;
- there is no permanent-delete endpoint;
- collections and ACL work;
- public file/folder/collection shares work without auth/password/token;
- deleted resources are never public;
- search/filter/listing is permission-aware;
- MIME/media metadata is persisted;
- PostgreSQL is the only supported DB;
- CLI and SQLite code do not exist;
- OpenAPI is complete;
- integration, concurrency, ACL, quota, Range, restore, and upload tests pass;
- operational health, audit, jobs, and reconciliation exist;
- documented Docker deployment can start the backend from an empty database.

## 32. Decisions that should remain stable during implementation

Unless a new explicit requirement changes them, treat these as architectural invariants:

1. Go backend.
2. PostgreSQL only.
3. Backend completed before client implementation.
4. Files and folders are represented by a unified hierarchical node model.
5. Discord stores canonical file chunks.
6. Chunk deduplication is global.
7. User quota is logical, owner-based, and unlimited by default.
8. Soft-delete releases quota.
9. No user-facing permanent delete.
10. Soft-deleted committed blobs remain forever/restorable.
11. Admin bypasses all normal resource ACL.
12. Normal cross-user access is through folder or collection grants.
13. Public shares are simple generate/revoke URLs without password/expiry/token scopes.
14. Authentication is session-based; no API keys/PAT.
15. MFA is optional TOTP initially.
16. No SQLite, CLI, CAPTCHA, retention, or legacy compatibility layer.
