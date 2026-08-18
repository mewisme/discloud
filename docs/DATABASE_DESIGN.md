# DisCloud Backend — PostgreSQL Database Design

> Companion document to `BACKEND_IMPLEMENTATION_PLAN.md`.
>
> Scope: PostgreSQL schema, invariants, indexing, transactions, quota accounting, ACL, upload/chunk storage, soft-delete/restore, collections, MFA, public shares, jobs, and audit.

## 1. Design goals

The database must support:

- multi-user accounts;
- one-time first-admin bootstrap;
- optional TOTP MFA;
- server-side sessions;
- hierarchical folders;
- file nodes in the same namespace as folders;
- ownership;
- admin override;
- inherited folder ACL;
- collection ACL;
- public file/folder/collection shares;
- chunked Discord-backed files;
- global chunk deduplication;
- resumable uploads;
- finite or unlimited per-user quota;
- soft-delete with indefinite restore;
- quota release on soft-delete;
- no permanent delete of committed resources;
- permission-aware search/listing;
- MIME/media metadata;
- background jobs;
- audit events.

The design optimizes first for correctness and understandable invariants. Premature denormalization should be avoided unless a benchmark demonstrates the need.

## 2. PostgreSQL baseline

### 2.1 Required database characteristics

- PostgreSQL is the only supported production database.
- Store timestamps as `timestamptz` in UTC.
- Use database transactions for all structural/quota operations.
- Use `bigint` for byte counts.
- Use UUIDs for internal identifiers.
- Generate UUIDv7 in Go so ordering does not depend on a specific PostgreSQL version.

### 2.2 Recommended extensions

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Optional:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

`citext` is useful for case-insensitive usernames.

`pg_trgm` is useful for fuzzy filename/folder search.

### 2.3 Naming conventions

- tables: plural snake_case;
- columns: snake_case;
- primary key: `id` unless one-to-one extension table naturally uses parent key as PK;
- foreign keys: `<entity>_id`;
- timestamps: `created_at`, `updated_at`, `deleted_at`;
- booleans: `is_*` when state is truly binary;
- logical states with more than two possibilities use text/enum/check constraints.

## 3. ID model

### 3.1 Internal IDs

Use UUIDv7 generated in Go.

Benefits:

- globally unique;
- sortable by time;
- better B-tree locality than random UUIDv4;
- safe for multi-instance server.

### 3.2 Public share IDs

Do not expose internal UUID as the only public share identifier.

Generate a separate cryptographically random URL-safe value with at least 128 bits entropy.

Example conceptual format:

```text
s_A8js72kP...<opaque>
```

The public ID is not called an API token, but possession of the URL grants public access, therefore it must be unguessable.

## 4. Core entity overview

```text
users
  |
  +-- sessions
  +-- mfa_totp
  +-- mfa_recovery_codes
  +-- nodes (owner)
  +-- collections (owner)
  +-- folder_permissions (grantee)
  +-- collection_permissions (grantee)

nodes
  +-- parent -> nodes(folder)
  +-- files (1:1 when kind=file)
  +-- folder_permissions (when kind=folder)
  +-- public_shares

files
  +-- file_chunks
        +-- chunks

collections
  +-- collection_items -> files
  +-- collection_permissions
  +-- public_shares

upload_sessions
  +-- upload_parts
        +-- chunks

jobs
audit_events
app_settings
```

## 5. Enum/value strategy

PostgreSQL enum types are acceptable for truly stable values, but this design prefers `text` + `CHECK` for easier migration.

Suggested constrained values:

```text
users.role:
  admin | user

users.status:
  active | disabled

nodes.kind:
  file | folder

permission level:
  view | edit | full

files.category:
  image | video | audio | document | text | archive | application | binary | other

upload_sessions.status:
  open | completing | completed | cancelled | expired | failed

jobs.status:
  queued | running | completed | failed | dead

public_shares.resource_type:
  node | collection
```

## 6. `users`

### 6.1 Purpose

Stores authentication identity, role, account state, and quota counters.

### 6.2 Proposed schema

```sql
CREATE TABLE users (
    id uuid PRIMARY KEY,
    username citext NOT NULL UNIQUE,
    password_hash text NOT NULL,

    role text NOT NULL DEFAULT 'user'
        CHECK (role IN ('admin', 'user')),

    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),

    storage_quota_bytes bigint NULL
        CHECK (storage_quota_bytes IS NULL OR storage_quota_bytes >= 0),

    storage_used_bytes bigint NOT NULL DEFAULT 0
        CHECK (storage_used_bytes >= 0),

    storage_reserved_bytes bigint NOT NULL DEFAULT 0
        CHECK (storage_reserved_bytes >= 0),

    must_change_password boolean NOT NULL DEFAULT false,

    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    disabled_at timestamptz NULL,
    password_changed_at timestamptz NOT NULL
);
```

### 6.3 Quota semantics

```text
storage_quota_bytes = NULL
```

means unlimited.

Finite check:

```text
storage_used_bytes + storage_reserved_bytes <= storage_quota_bytes
```

must be enforced transactionally on operations that reserve/restore/copy/transfer logical bytes.

### 6.4 Do not hard-delete users in V1

Use `status='disabled'`.

User data remains intact.

Disabling a user should revoke all active sessions in the same administrative operation.

## 7. `sessions`

### 7.1 Purpose

Server-side cookie sessions.

### 7.2 Proposed schema

```sql
CREATE TABLE sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    token_hash bytea NOT NULL UNIQUE,

    user_agent text NULL,
    ip_address inet NULL,

    created_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz NULL
);

CREATE INDEX sessions_user_active_idx
    ON sessions (user_id, expires_at)
    WHERE revoked_at IS NULL;
```

### 7.3 Session token handling

- Cookie gets random plaintext secret.
- Database stores SHA-256 hash only.
- Lookup hashes presented cookie and compares by indexed `token_hash`.

## 8. MFA tables

### 8.1 `mfa_totp`

One active TOTP configuration per user.

```sql
CREATE TABLE mfa_totp (
    user_id uuid PRIMARY KEY REFERENCES users(id),
    secret_ciphertext bytea NOT NULL,
    key_version integer NOT NULL DEFAULT 1,
    confirmed_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
```

TOTP secret is encrypted with application master key.

### 8.2 `mfa_enrollments`

Temporary pending enrollment before user proves they can generate a valid code.

```sql
CREATE TABLE mfa_enrollments (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    secret_ciphertext bytea NOT NULL,
    key_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
);

CREATE INDEX mfa_enrollments_expiry_idx
    ON mfa_enrollments (expires_at);
```

Only one pending enrollment per user is needed; application may replace previous pending row.

### 8.3 `mfa_recovery_codes`

```sql
CREATE TABLE mfa_recovery_codes (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    code_hash bytea NOT NULL,
    created_at timestamptz NOT NULL,
    used_at timestamptz NULL,

    UNIQUE (user_id, code_hash)
);

CREATE INDEX mfa_recovery_codes_unused_idx
    ON mfa_recovery_codes (user_id)
    WHERE used_at IS NULL;
```

### 8.4 `login_challenges`

Password-correct but MFA-pending login state.

```sql
CREATE TABLE login_challenges (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz NULL
);

CREATE INDEX login_challenges_expiry_idx
    ON login_challenges (expires_at)
    WHERE consumed_at IS NULL;
```

## 9. Unified `nodes` table

### 9.1 Why unified nodes

Files and folders share:

- name;
- owner;
- parent;
- hierarchy;
- move/rename;
- soft-delete;
- trash/restore;
- namespace conflicts.

A single `nodes` table prevents cross-table duplicate-name problems and simplifies recursive queries.

### 9.2 Proposed schema

```sql
CREATE TABLE nodes (
    id uuid PRIMARY KEY,

    kind text NOT NULL
        CHECK (kind IN ('file', 'folder')),

    owner_user_id uuid NOT NULL REFERENCES users(id),
    parent_id uuid NULL REFERENCES nodes(id),

    name text NOT NULL,
    name_key text NOT NULL,

    is_root boolean NOT NULL DEFAULT false,
    is_favorite boolean NOT NULL DEFAULT false,

    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,

    deleted_at timestamptz NULL,
    deleted_by uuid NULL REFERENCES users(id),

    CHECK (NOT is_root OR kind = 'folder'),
    CHECK (NOT is_root OR parent_id IS NULL)
);
```

### 9.3 `name_key`

Generate in Go from:

1. trim policy as defined by product;
2. Unicode NFC normalization;
3. Unicode case folding;
4. reject illegal path separators/NUL/dot-special names.

Store original display `name` separately.

This avoids platform-specific case collisions for a future desktop app.

### 9.4 Active sibling uniqueness

```sql
CREATE UNIQUE INDEX nodes_active_sibling_name_uq
    ON nodes (parent_id, name_key)
    WHERE deleted_at IS NULL AND parent_id IS NOT NULL;
```

This enforces one active file/folder name in a folder namespace.

Root uniqueness is separate:

```sql
CREATE UNIQUE INDEX nodes_user_root_uq
    ON nodes (owner_user_id)
    WHERE is_root = true;
```

### 9.5 Hierarchy indexes

```sql
CREATE INDEX nodes_parent_active_idx
    ON nodes (parent_id, name_key)
    WHERE deleted_at IS NULL;

CREATE INDEX nodes_owner_idx
    ON nodes (owner_user_id);

CREATE INDEX nodes_deleted_idx
    ON nodes (deleted_at)
    WHERE deleted_at IS NOT NULL;
```

### 9.6 Trigram search

```sql
CREATE INDEX nodes_name_trgm_idx
    ON nodes USING gin (name gin_trgm_ops);
```

### 9.7 Parent kind invariant

Application must ensure every non-null `parent_id` points to a folder node.

For strong DB enforcement, add a constraint trigger that verifies parent kind is `folder` on insert/update.

## 10. Root folder creation

User creation transaction:

1. insert `users` row;
2. insert root `nodes` row:
   - kind `folder`;
   - owner = user;
   - parent = null;
   - `is_root=true`;
3. commit.

If root insertion fails, user creation rolls back.

## 11. `files`

### 11.1 Purpose

One-to-one extension for `nodes.kind='file'`.

### 11.2 Proposed schema

```sql
CREATE TABLE files (
    node_id uuid PRIMARY KEY REFERENCES nodes(id),

    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    chunk_size_bytes integer NOT NULL CHECK (chunk_size_bytes > 0),

    sha256 bytea NULL,

    mime_type text NOT NULL DEFAULT 'application/octet-stream',
    extension text NULL,
    category text NOT NULL DEFAULT 'binary'
        CHECK (category IN (
            'image', 'video', 'audio', 'document', 'text',
            'archive', 'application', 'binary', 'other'
        )),

    width integer NULL CHECK (width IS NULL OR width > 0),
    height integer NULL CHECK (height IS NULL OR height > 0),
    duration_ms bigint NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
    bitrate_bps bigint NULL CHECK (bitrate_bps IS NULL OR bitrate_bps >= 0),
    codec text NULL,

    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata_status text NOT NULL DEFAULT 'pending'
        CHECK (metadata_status IN ('pending', 'ready', 'failed', 'skipped')),
    metadata_error text NULL,

    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
```

### 11.3 Indexes

```sql
CREATE INDEX files_mime_idx ON files (mime_type);
CREATE INDEX files_category_idx ON files (category);
CREATE INDEX files_size_idx ON files (size_bytes);
CREATE INDEX files_sha_idx ON files (sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX files_metadata_gin_idx ON files USING gin (metadata);
```

### 11.4 File-node invariant

Use application transaction plus optional DB trigger to ensure:

- every `files.node_id` references `nodes.kind='file'`;
- every committed `nodes.kind='file'` has exactly one `files` row.

## 12. `storage_bots`

### 12.1 Purpose

Stable DB identity for a Discord bot/storage credential without storing plaintext token in DB.

Tokens should be supplied through secret configuration and matched by a stable key.

```sql
CREATE TABLE storage_bots (
    id uuid PRIMARY KEY,
    config_key text NOT NULL UNIQUE,
    discord_user_id text NULL,
    display_name text NULL,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
```

`config_key` maps to runtime secret config, e.g. `primary`, `secondary-1`.

## 13. `chunks`

### 13.1 Purpose

Canonical global deduplicated blob records.

### 13.2 Proposed schema

```sql
CREATE TABLE chunks (
    id uuid PRIMARY KEY,
    sha256 bytea NOT NULL,
    size_bytes integer NOT NULL CHECK (size_bytes > 0),

    storage_bot_id uuid NOT NULL REFERENCES storage_bots(id),
    discord_guild_id text NULL,
    discord_channel_id text NOT NULL,
    discord_message_id text NOT NULL,
    discord_attachment_id text NULL,
    attachment_filename text NOT NULL,

    status text NOT NULL DEFAULT 'ready'
        CHECK (status IN ('ready', 'uncommitted', 'failed')),

    created_at timestamptz NOT NULL,
    committed_at timestamptz NULL,

    UNIQUE (sha256, size_bytes),
    UNIQUE (discord_channel_id, discord_message_id)
);
```

### 13.3 Why hash + size uniqueness

SHA-256 collision is practically negligible, but pairing size makes accidental misuse/debugging safer.

### 13.4 No GC of committed chunks

Because there is no permanent-delete of committed files:

- chunks referenced by any committed file are never physically deleted by normal lifecycle;
- chunks can be reused by future uploads even if all referencing files are currently soft-deleted.

Technical cleanup may remove only never-committed orphan chunks.

## 14. `file_chunks`

Ordered mapping from logical file to deduplicated chunks.

```sql
CREATE TABLE file_chunks (
    file_id uuid NOT NULL REFERENCES files(node_id),
    part_index integer NOT NULL CHECK (part_index >= 0),
    chunk_id uuid NOT NULL REFERENCES chunks(id),
    part_size_bytes integer NOT NULL CHECK (part_size_bytes > 0),

    PRIMARY KEY (file_id, part_index)
);

CREATE INDEX file_chunks_chunk_idx ON file_chunks (chunk_id);
```

Do not store a mutable reference count on `chunks` initially. Derive references when needed; a counter can drift under complex retries unless carefully maintained.

## 15. Upload sessions

### 15.1 `upload_sessions`

```sql
CREATE TABLE upload_sessions (
    id uuid PRIMARY KEY,

    actor_user_id uuid NOT NULL REFERENCES users(id),
    owner_user_id uuid NOT NULL REFERENCES users(id),
    parent_folder_id uuid NOT NULL REFERENCES nodes(id),

    name text NOT NULL,
    name_key text NOT NULL,

    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    chunk_size_bytes integer NOT NULL CHECK (chunk_size_bytes > 0),
    expected_parts integer NOT NULL CHECK (expected_parts >= 0),

    mime_type_hint text NULL,
    file_sha256 bytea NULL,

    reserved_bytes bigint NOT NULL CHECK (reserved_bytes >= 0),

    status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'completing', 'completed', 'cancelled', 'expired', 'failed')),

    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    completed_at timestamptz NULL,
    closed_at timestamptz NULL,

    committed_file_id uuid NULL REFERENCES files(node_id)
);
```

Indexes:

```sql
CREATE INDEX upload_sessions_owner_open_idx
    ON upload_sessions (owner_user_id, expires_at)
    WHERE status IN ('open', 'completing');

CREATE INDEX upload_sessions_expiry_idx
    ON upload_sessions (expires_at)
    WHERE status = 'open';
```

### 15.2 Reservation invariant

For open sessions:

```text
reserved_bytes = size_bytes
```

unless future protocol supports partial reservation.

Quota counter transition must be transactionally paired with session state changes.

## 16. `upload_parts`

```sql
CREATE TABLE upload_parts (
    upload_id uuid NOT NULL REFERENCES upload_sessions(id),
    part_index integer NOT NULL CHECK (part_index >= 0),
    chunk_id uuid NOT NULL REFERENCES chunks(id),
    part_size_bytes integer NOT NULL CHECK (part_size_bytes > 0),
    sha256 bytea NOT NULL,
    created_at timestamptz NOT NULL,

    PRIMARY KEY (upload_id, part_index)
);

CREATE INDEX upload_parts_chunk_idx ON upload_parts (chunk_id);
```

Retrying the same part index should compare hash/size and be idempotent if identical.

## 17. Folder permissions

### 17.1 Why separate table instead of polymorphic ACL

Use dedicated ACL tables for referential integrity and simpler query plans.

### 17.2 `folder_permissions`

```sql
CREATE TABLE folder_permissions (
    folder_id uuid NOT NULL REFERENCES nodes(id),
    user_id uuid NOT NULL REFERENCES users(id),

    level text NOT NULL
        CHECK (level IN ('view', 'edit', 'full')),

    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,

    PRIMARY KEY (folder_id, user_id)
);

CREATE INDEX folder_permissions_user_idx
    ON folder_permissions (user_id, folder_id);
```

Application/trigger ensures `folder_id` is a folder node.

### 17.3 No owner self-grant needed

Owner already has full access implicitly.

Do not require ACL row for owner.

### 17.4 No admin grant needed

Admin override is implicit from `users.role='admin'`.

## 18. Folder permission resolution query

Given target node `N` and user `U`:

1. admin -> `full`;
2. node owner -> `full`;
3. walk ancestors from target parent upward;
4. find grants for `U`;
5. choose strongest level among applicable ancestors.

Conceptual recursive CTE:

```sql
WITH RECURSIVE ancestors AS (
    SELECT n.id, n.parent_id, 0 AS depth
    FROM nodes n
    WHERE n.id = $1

    UNION ALL

    SELECT p.id, p.parent_id, a.depth + 1
    FROM nodes p
    JOIN ancestors a ON a.parent_id = p.id
)
SELECT fp.level
FROM ancestors a
JOIN folder_permissions fp ON fp.folder_id = a.id
WHERE fp.user_id = $2
ORDER BY
    CASE fp.level
        WHEN 'full' THEN 3
        WHEN 'edit' THEN 2
        WHEN 'view' THEN 1
    END DESC
LIMIT 1;
```

Exact production query should account for target file vs folder and effective deletion.

## 19. Collections

### 19.1 `collections`

```sql
CREATE TABLE collections (
    id uuid PRIMARY KEY,
    owner_user_id uuid NOT NULL REFERENCES users(id),
    name text NOT NULL,
    name_key text NOT NULL,
    description text NULL,

    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,

    deleted_at timestamptz NULL,
    deleted_by uuid NULL REFERENCES users(id)
);
```

Unique active name per owner:

```sql
CREATE UNIQUE INDEX collections_owner_active_name_uq
    ON collections (owner_user_id, name_key)
    WHERE deleted_at IS NULL;
```

### 19.2 `collection_items`

V1 collections contain files only.

```sql
CREATE TABLE collection_items (
    collection_id uuid NOT NULL REFERENCES collections(id),
    file_id uuid NOT NULL REFERENCES files(node_id),
    added_by uuid NOT NULL REFERENCES users(id),
    added_at timestamptz NOT NULL,

    PRIMARY KEY (collection_id, file_id)
);

CREATE INDEX collection_items_file_idx
    ON collection_items (file_id);
```

Do not remove membership when a file is soft-deleted. Normal queries hide deleted files; restore makes membership visible again.

### 19.3 `collection_permissions`

```sql
CREATE TABLE collection_permissions (
    collection_id uuid NOT NULL REFERENCES collections(id),
    user_id uuid NOT NULL REFERENCES users(id),

    level text NOT NULL
        CHECK (level IN ('view', 'edit', 'full')),

    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,

    PRIMARY KEY (collection_id, user_id)
);

CREATE INDEX collection_permissions_user_idx
    ON collection_permissions (user_id, collection_id);
```

## 20. Public shares

### 20.1 Proposed schema

```sql
CREATE TABLE public_shares (
    id uuid PRIMARY KEY,
    public_id text NOT NULL UNIQUE,

    resource_type text NOT NULL
        CHECK (resource_type IN ('node', 'collection')),

    node_id uuid NULL REFERENCES nodes(id),
    collection_id uuid NULL REFERENCES collections(id),

    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    revoked_at timestamptz NULL,
    revoked_by uuid NULL REFERENCES users(id),

    CHECK (
        (resource_type = 'node' AND node_id IS NOT NULL AND collection_id IS NULL)
        OR
        (resource_type = 'collection' AND collection_id IS NOT NULL AND node_id IS NULL)
    )
);
```

### 20.2 One active share per resource

```sql
CREATE UNIQUE INDEX public_shares_active_node_uq
    ON public_shares (node_id)
    WHERE node_id IS NOT NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX public_shares_active_collection_uq
    ON public_shares (collection_id)
    WHERE collection_id IS NOT NULL AND revoked_at IS NULL;
```

Regenerate flow:

1. revoke existing active row;
2. insert new row with new public ID.

### 20.3 Soft-delete interaction

Trash transaction must revoke relevant active shares.

Restore does not clear `revoked_at` and does not recreate old link.

## 21. Soft-delete model in detail

### 21.1 Direct deletion

Only the selected node gets:

```text
deleted_at
deleted_by
```

Descendants are not mass-updated.

### 21.2 Effective active query

A node is active only when no node on its ancestor chain, including itself, has `deleted_at IS NOT NULL`.

Conceptual query for one node:

```sql
WITH RECURSIVE chain AS (
    SELECT id, parent_id, deleted_at
    FROM nodes
    WHERE id = $1

    UNION ALL

    SELECT p.id, p.parent_id, p.deleted_at
    FROM nodes p
    JOIN chain c ON c.parent_id = p.id
)
SELECT NOT EXISTS (
    SELECT 1
    FROM chain
    WHERE deleted_at IS NOT NULL
) AS is_effectively_active;
```

### 21.3 Trash listing

List directly deleted roots that are not hidden by another directly deleted ancestor, or return direct deletions with enough ancestry metadata for client grouping.

A practical query should avoid showing a directly deleted child separately when its parent is also currently deleted, unless the API requests `includeNested=true`.

### 21.4 Restore parent behavior

Example:

```text
A/        directly deleted after B
  B/      was directly deleted earlier
    x
```

Restoring A clears A's marker.

B remains directly deleted.

This preserves user intent.

## 22. Quota accounting in detail

### 22.1 Used bytes source of truth

Derived truth:

```text
sum(files.size_bytes)
where node.owner_user_id = user
and node is effectively active
```

Cached counter:

```text
users.storage_used_bytes
```

### 22.2 Reserved bytes source of truth

Derived truth:

```text
sum(upload_sessions.reserved_bytes)
where owner_user_id = user
and status in ('open', 'completing')
```

Cached counter:

```text
users.storage_reserved_bytes
```

### 22.3 Upload reservation transaction

Pseudo-SQL:

```sql
BEGIN;

SELECT storage_quota_bytes,
       storage_used_bytes,
       storage_reserved_bytes
FROM users
WHERE id = $owner
FOR UPDATE;

-- application checks finite quota

UPDATE users
SET storage_reserved_bytes = storage_reserved_bytes + $size,
    updated_at = now()
WHERE id = $owner;

INSERT INTO upload_sessions (..., reserved_bytes, status)
VALUES (..., $size, 'open');

COMMIT;
```

### 22.4 Finalize transaction

```text
reserved -= file size
used += file size
create committed node/file/file_chunks
mark session completed
```

all in one transaction.

### 22.5 Soft-delete file

Lock owner user row and node row.

If file is effectively active:

```text
used -= file.size
node.deleted_at = now
```

If already effectively deleted, reject duplicate delete or treat idempotently without decrementing twice.

### 22.6 Soft-delete folder

Need size of descendants that are currently active and will become inactive.

Important: stop traversal through already directly-deleted nested folders because their files were already removed from quota.

Conceptual recursive CTE:

```sql
WITH RECURSIVE subtree AS (
    SELECT n.id, n.kind, n.deleted_at
    FROM nodes n
    WHERE n.id = $folder_id

    UNION ALL

    SELECT c.id, c.kind, c.deleted_at
    FROM nodes c
    JOIN subtree p ON c.parent_id = p.id
    WHERE p.deleted_at IS NULL
      AND c.deleted_at IS NULL
)
SELECT COALESCE(SUM(f.size_bytes), 0)
FROM subtree s
JOIN files f ON f.node_id = s.id;
```

Production query must exclude the folder root's soon-to-be deletion state correctly and can group by owner if admin-only mixed ownership is ever supported.

Then:

1. lock affected owner quota row(s);
2. decrement used bytes;
3. mark only folder root deleted;
4. revoke shares;
5. audit;
6. commit.

### 22.7 Restore folder

Traverse only descendants that will become active after clearing the root marker. Nested directly-deleted subtrees stay excluded.

Calculate bytes before mutation, check quota, then increment used bytes and clear marker in one transaction.

### 22.8 Restore into another parent

If original parent is deleted/unavailable or name conflicts:

- API can accept `parentFolderId` and optional new name;
- move + restore happens in one transaction;
- destination must be active;
- normal user same-owner rule applies;
- quota remains based on owner unless admin performs ownership transfer.

## 23. Ownership transfer

Cross-owner transfer should be an explicit admin operation, not a side effect of a normal user's move.

For a file transfer:

1. lock source and destination users;
2. check destination quota for active logical size;
3. decrement source used bytes if active;
4. increment destination used bytes if active;
5. update node owner;
6. update parent destination;
7. audit.

For a folder transfer:

- all descendant nodes should become destination owner to preserve single-owner tree invariant;
- compute active logical bytes;
- quota check destination;
- recursively update owner IDs;
- update usage counters;
- perform in one transaction, potentially as an admin background operation for very large trees if transaction size becomes a problem.

V1 may intentionally refuse cross-owner folder transfer until the dedicated admin transfer workflow is implemented.

## 24. `jobs`

### 24.1 Purpose

PostgreSQL-backed job queue.

### 24.2 Proposed schema

```sql
CREATE TABLE jobs (
    id uuid PRIMARY KEY,
    type text NOT NULL,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'dead')),

    payload jsonb NOT NULL DEFAULT '{}'::jsonb,

    priority integer NOT NULL DEFAULT 0,
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 5,

    run_at timestamptz NOT NULL,
    locked_at timestamptz NULL,
    locked_by text NULL,

    last_error text NULL,

    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    completed_at timestamptz NULL
);

CREATE INDEX jobs_claim_idx
    ON jobs (priority DESC, run_at, created_at)
    WHERE status = 'queued';
```

### 24.3 Claim query

Use `FOR UPDATE SKIP LOCKED` so multiple workers can safely claim different jobs.

## 25. `audit_events`

### 25.1 Purpose

Append-only security/administrative event trail.

```sql
CREATE TABLE audit_events (
    id uuid PRIMARY KEY,
    actor_user_id uuid NULL REFERENCES users(id),

    action text NOT NULL,
    resource_type text NULL,
    resource_id uuid NULL,

    request_id text NULL,
    ip_address inet NULL,

    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL
);

CREATE INDEX audit_events_actor_time_idx
    ON audit_events (actor_user_id, created_at DESC);

CREATE INDEX audit_events_resource_idx
    ON audit_events (resource_type, resource_id, created_at DESC);

CREATE INDEX audit_events_time_idx
    ON audit_events (created_at DESC);
```

Application should not expose update/delete operations for audit events.

## 26. `app_settings`

Use for non-secret runtime configuration if needed.

```sql
CREATE TABLE app_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_by uuid NULL REFERENCES users(id),
    updated_at timestamptz NOT NULL
);
```

Do not store plaintext Discord bot tokens, application master key, or session signing/encryption secrets here.

## 27. Optional derived media table

If media derivatives become part of backend v1.1+, use a separate table rather than bloating `files`.

```sql
CREATE TABLE file_derivatives (
    id uuid PRIMARY KEY,
    file_id uuid NOT NULL REFERENCES files(node_id),
    kind text NOT NULL,
    mime_type text NOT NULL,
    width integer NULL,
    height integer NULL,
    size_bytes bigint NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,

    UNIQUE (file_id, kind)
);
```

Actual derivative bytes can use the same chunk/blob infrastructure if desired.

Derived bytes do not count toward user logical quota.

## 28. Effective visibility rules

A normal authenticated user can view a file node if any is true:

1. user owns node;
2. user has inherited `view|edit|full` folder permission;
3. file is included in an active collection user can view.

Administrator can always view.

Public request can view only through a valid active public share context.

Soft-deleted/effectively-deleted nodes are excluded from all normal/private/public views except Trash/restore/admin-specific queries.

## 29. Collection-only access

A user with collection access but no folder access:

- can view/download active file items through collection context;
- cannot enumerate parent folder;
- cannot navigate siblings;
- cannot structurally move/delete underlying file unless separately authorized through folder/ownership/admin rules.

This must be enforced in backend services and query shapes.

## 30. Search design

### 30.1 Name search

Use `pg_trgm` over `nodes.name`.

Example:

```sql
SELECT ...
FROM nodes
WHERE name % $query
ORDER BY similarity(name, $query) DESC;
```

Permission constraints must be joined/applied before returning results.

### 30.2 Avoid ACL N+1

Do not resolve ACL by running one recursive query per search result.

For large search/list endpoints, build SQL that unions accessible ownership roots, inherited folder grants, and collection membership in set form.

An acceptable first implementation can use a two-stage CTE while dataset is modest, but benchmark with representative trees.

## 31. Folder listing design

Given folder F:

1. verify caller can view F;
2. select children where `parent_id=F` and `deleted_at IS NULL`;
3. because F is confirmed effectively active, direct child active state is sufficient for one-level listing;
4. enrich file rows from `files`;
5. apply pagination/sort.

If F is under a deleted ancestor, authorization/resource lookup should treat it as unavailable outside Trash.

## 32. Trash listing design

Trash should list directly deleted roots visible to caller.

For user's own trash:

- `owner_user_id = user`;
- `deleted_at IS NOT NULL`;
- exclude entries whose ancestor is also deleted if showing only top-level trash roots.

Admin can filter by owner.

## 33. Public share resolution

Resolver transaction/query should verify:

- share row exists;
- `revoked_at IS NULL`;
- target exists;
- target is not directly/effectively deleted;
- if collection, collection is active and items are filtered for active files.

Do not resolve public share by returning canonical Discord CDN URL as the only authorization boundary.

## 34. Database constraints worth implementing as triggers

PostgreSQL cannot express every cross-table invariant with simple FK/CHECK.

Useful constraint triggers:

1. `nodes.parent_id` references a folder node.
2. `files.node_id` references node with `kind='file'`.
3. `folder_permissions.folder_id` references node with `kind='folder'`.
4. root node cannot be moved/deleted through direct SQL.

However, do not overuse triggers for business logic like ACL/quota. Keep business transitions explicit in Go transactions.

## 35. Naming and restore conflicts

Because active-name uniqueness is a partial index, soft-deleted node can share a name with a new active node.

Example:

```text
trash: report.pdf
active: report.pdf
```

Restore must then return a conflict unless caller provides a new name or destination.

Recommended API behavior:

```text
409 name_conflict
```

with conflicting active node ID if caller is authorized to know it.

## 36. Soft-delete and share revocation transaction

For deleting a file:

```text
BEGIN
  lock node
  verify active + permission
  lock owner quota row
  decrement used bytes
  set node.deleted_at/deleted_by
  revoke active public share for node
  insert audit event
COMMIT
```

For deleting a folder:

```text
BEGIN
  lock folder
  verify active + permission
  calculate active descendant logical bytes
  lock affected quota rows
  decrement used bytes
  set only root folder deleted_at/deleted_by
  revoke shares rooted at folder and descendant nodes
  insert audit event
COMMIT
```

Large subtree share revocation may require set-based `UPDATE` using recursive descendant CTE.

## 37. Restore transaction

```text
BEGIN
  lock node
  verify directly deleted
  validate parent/destination active
  calculate bytes that become active
  lock owner quota row
  enforce quota
  validate name conflict
  clear deleted_at/deleted_by
  optional move/rename
  increment used bytes
  insert audit event
COMMIT
```

Old public shares remain revoked.

## 38. No permanent-delete consequences

This requirement has direct schema/operations consequences:

- `nodes`, `files`, `file_chunks`, and committed `chunks` are never removed through normal user/admin APIs;
- Trash can grow indefinitely;
- database backups retain all historical committed resources;
- physical Discord chunk usage does not shrink when quota is released;
- storage dashboards must separately show:
  - active logical bytes;
  - trashed logical bytes;
  - total logical committed bytes;
  - physical unique chunk bytes;
  - dedupe savings estimate.

Suggested admin storage calculations:

```text
active logical = sum active file sizes
trash logical = sum files effectively deleted
committed logical = active + trash
physical unique = sum ready committed chunk sizes
```

## 39. Orphan chunk cleanup boundary

No permanent delete does not mean abandoned upload garbage must live forever.

Safe GC candidate definition:

- chunk status `uncommitted`;
- older than technical threshold;
- not referenced by any `file_chunks`;
- not referenced by any active/open `upload_parts`;
- not in a completing transaction/job.

Only such chunks may be physically deleted from Discord by technical GC.

Once a chunk is referenced by a committed file, it is not a GC candidate under current product policy.

## 40. Quota reconciliation query

Reconciliation should calculate effective-active bytes, not just `nodes.deleted_at IS NULL`, because descendants of a deleted folder may have null own marker.

For very large datasets, implement per-user recursive traversal or a set-based ancestor-deletion CTE and benchmark.

Reconciliation output should compare:

```text
computed_used
stored_used
computed_reserved
stored_reserved
```

and repair mismatches transactionally while writing an audit/operator event.

## 41. Migration order

Recommended migration sequence:

```text
000001_extensions.sql
000002_users.sql
000003_sessions.sql
000004_mfa.sql
000005_nodes.sql
000006_files.sql
000007_storage_bots_chunks.sql
000008_uploads.sql
000009_folder_permissions.sql
000010_collections.sql
000011_public_shares.sql
000012_jobs.sql
000013_audit.sql
000014_settings.sql
000015_search_indexes.sql
000016_constraint_triggers.sql
```

Do not combine the entire database into one migration; smaller migrations improve review and troubleshooting.

## 42. Transaction isolation

Default `READ COMMITTED` is adequate for most operations when explicit row locks are used.

Use stronger coordination for:

- first-admin setup;
- quota reservations;
- name conflicts under concurrent create/move/restore;
- same-chunk concurrent registration.

Prefer explicit `FOR UPDATE`, unique constraints, and advisory locks over globally raising isolation to `SERIALIZABLE` unless a specific transaction benefits from it.

## 43. Setup concurrency

`POST /setup` must be race-safe.

Recommended:

```text
BEGIN
  pg_advisory_xact_lock(constant_setup_key)
  SELECT count(*) FROM users
  if count > 0 -> fail
  create admin
  create root node
COMMIT
```

Only one concurrent caller can create the bootstrap admin.

## 44. Chunk dedupe concurrency

Global unique constraint:

```text
(sha256, size_bytes)
```

is the final guard.

Because Discord upload is external I/O, design carefully to avoid duplicate remote uploads.

Recommended flow uses a hash-derived advisory lock around the create-or-reuse decision, while avoiding a long open SQL transaction when possible.

If a duplicate remote upload still occurs due process crash, orphan cleanup may remove the unregistered/uncommitted duplicate.

## 45. Index checklist

Required/likely indexes:

### Identity

- users username unique;
- sessions token hash unique;
- sessions active by user;
- login challenge token hash unique.

### Nodes

- active `(parent_id, name_key)` unique;
- user root unique;
- parent active listing;
- owner;
- deleted;
- trigram name.

### Files

- category;
- MIME;
- size;
- SHA when non-null;
- metadata GIN only if queries justify it.

### Chunks

- unique hash+size;
- unique message locator.

### Uploads

- open sessions by owner;
- expiry;
- parts primary key;
- chunk references.

### ACL

- folder permissions by user;
- collection permissions by user.

### Collections

- active owner name unique;
- item reverse index.

### Shares

- public ID unique;
- one active share per target.

### Jobs

- queued claim index.

### Audit

- actor/time;
- resource/time;
- global time.

## 46. Database invariants checklist

The application and database together must guarantee:

- username unique case-insensitively;
- every user has exactly one root folder;
- root is folder and parentless;
- a node parent is always folder;
- no active sibling name collision;
- no folder cycle;
- file extension row matches file node;
- folder grant target is folder;
- owner/admin implicit access does not require ACL row;
- no public share targets two resource types simultaneously;
- no more than one active public share per target;
- upload reservation counter matches open session lifecycle;
- quota counters never go negative;
- soft-delete decrements quota once;
- restore increments quota once;
- nested deleted subtrees do not double-release quota;
- no permanent-delete operation removes committed resource rows/chunks;
- disabled user cannot maintain active sessions;
- recovery code cannot be used twice;
- expired MFA challenge cannot create session.

## 47. Suggested repository/query boundaries

Recommended SQL/query groups:

```text
queries/users.sql
queries/sessions.sql
queries/mfa.sql
queries/nodes.sql
queries/acl.sql
queries/files.sql
queries/chunks.sql
queries/uploads.sql
queries/quota.sql
queries/collections.sql
queries/shares.sql
queries/search.sql
queries/jobs.sql
queries/audit.sql
```

Complex recursive operations should be named clearly, e.g.:

```text
GetNodeAncestorChain
GetActiveSubtreeLogicalBytes
GetEffectiveFolderPermission
ListTrashRoots
MoveNode
RestoreNodeWithQuota
ReconcileUserUsage
```

## 48. Database test matrix

At minimum, integration tests must cover:

### Users/auth

- concurrent bootstrap;
- case-insensitive username conflict;
- user create + root atomicity;
- disable revokes sessions;
- MFA recovery one-time use.

### Hierarchy

- create nested folders;
- duplicate file/folder same name conflict;
- case-folded conflict;
- move;
- cycle rejection;
- root move/delete rejection.

### ACL

- owner full;
- admin full;
- inherited view/edit/full;
- no grant means no access;
- collection-only access cannot enumerate parent folder.

### Quota

- unlimited;
- finite upload reservation;
- concurrent reservation race;
- finalize reserved -> used;
- cancel releases reserved;
- soft-delete file releases used;
- soft-delete folder releases active descendants only;
- nested already-deleted subtree not double-counted;
- restore consumes quota;
- restore quota conflict.

### Upload/chunks

- part idempotency;
- same hash reuse;
- file chunk ordering;
- finalize all parts required;
- expired session cannot finalize.

### Trash

- deleted ancestor makes descendant effectively deleted;
- parent restore does not restore previously deleted child;
- public share revoked;
- collection membership preserved.

### Public shares

- one active share per resource;
- regenerated public ID differs;
- revoked share unresolved;
- deleted target unresolved.

### Jobs/audit

- SKIP LOCKED claim uniqueness;
- retry transition;
- audit event append path.

## 49. Future schema evolution hooks

The design intentionally leaves room for:

- direct file ACL, if later truly required;
- explicit deny rules;
- passkeys/WebAuthn;
- file versions;
- comments/activity feeds;
- content extraction and full-text search;
- tags;
- thumbnails/transcodes;
- multiple storage backends;
- organization/team ownership;
- retention/permanent delete only if product policy explicitly changes.

Do not implement these prematurely.

## 50. Final database decisions

Treat the following as the database baseline:

1. PostgreSQL only.
2. UUIDv7 internal IDs generated in Go.
3. `users` contains cached logical quota counters.
4. Unified `nodes` table represents files and folders.
5. `files` is one-to-one extension of file nodes.
6. Each user has one immutable root folder.
7. Normal user trees remain single-owner; cross-owner transfer is explicit admin behavior.
8. Folder ACL is inherited and uses `view/edit/full`.
9. Collection ACL is separate from folder structural authority.
10. Chunk storage is globally deduplicated by SHA-256 + size.
11. Upload sessions reserve quota before data transfer completes.
12. Soft-delete stores direct `deleted_at/deleted_by` only on selected node.
13. Effective deletion includes deleted ancestors.
14. Soft-delete releases logical quota immediately.
15. Restore consumes quota and may fail on finite quota.
16. There is no permanent-delete API for committed resources.
17. Committed soft-deleted blobs are never GC'd under current policy.
18. Only uncommitted orphan chunks may be technically cleaned.
19. Public shares are high-entropy generate/revoke links with no password/expiry/token scope.
20. Public shares are revoked on trash and never automatically restored.
21. PostgreSQL-backed jobs replace the need for Redis/Valkey in the initial architecture.
22. Audit events record security-sensitive and structural mutations.
