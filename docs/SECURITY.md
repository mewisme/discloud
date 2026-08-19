# DisCloud Security Model

This document records security boundaries and invariants that must remain true
as the backend evolves.

## Trust boundaries

DisCloud has five primary trust boundaries:

1. browser or API client to the HTTP server;
2. authenticated normal user to another ownership domain;
3. administrator to privileged operational APIs;
4. DisCloud backend to PostgreSQL;
5. DisCloud backend to the configured Discord storage channel.

Anonymous public-share requests form a separate intentionally unauthenticated
boundary.

## Authentication

DisCloud uses server-side sessions.

The browser receives the opaque session token.

PostgreSQL stores only the token hash.

Session cookies must remain:

- `HttpOnly`;
- configured with an appropriate `SameSite` mode;
- `Secure` when deployed over HTTPS;
- `Secure` whenever `SameSite=None` is used.

Raw session tokens must never be written to logs, audit metadata, jobs, or
database columns other than their one-way derived representation.

Password changes, administrative password resets, user disable operations, and
security-sensitive account recovery flows must revoke sessions where required
by their product contract.

## CSRF

State-changing browser requests are same-origin only.

Unsafe methods must reject:

- cross-origin `Origin`;
- cross-origin `Referer`;
- `Sec-Fetch-Site: cross-site`;
- `Sec-Fetch-Site: same-site`;
- malformed fetch-site metadata.

Requests that do not contain browser fetch metadata may be accepted as
non-browser API clients, but normal authentication and authorization still
apply.

Safe read methods must not perform mutations.

## Authorization

Administrator access is globally privileged.

Normal users must never gain access merely because they know a UUID.

Folder authorization inherits through the folder hierarchy.

Collection authorization is logical only and must not reveal otherwise hidden
folder structure.

Normal users must not move content across ownership domains.

Content created inside a shared folder belongs to the folder owner.

## Public shares

Public share IDs are bearer-style opaque identifiers.

Public APIs must never expose:

- Discord bot tokens;
- Discord CDN URLs;
- Discord message-management APIs;
- internal session credentials;
- private folder ancestry that is outside the share boundary.

Trashing a shared resource revokes its public shares.

Restoring the resource must not reactivate the old public share automatically.

## File storage

Discord attachments are physical blob storage.

PostgreSQL is canonical for chunk identity and locators.

A committed `ready` chunk must never be physically deleted by normal product
lifecycle.

Technical garbage collection is restricted to old `uncommitted` chunks that
are no longer protected by active upload or committed-file references.

Chunk deduplication and orphan cleanup must serialize on the same digest and
size identity.

## Uploads

Client-provided chunk hashes are untrusted input and must be verified before
storage registration.

An upload reservation must not allow:

```text
storage_used_bytes + storage_reserved_bytes > storage_quota_bytes
````

for finite quotas.

Finalize must be idempotent.

Concurrent finalize calls must create only:

* one file node;
* one set of file-chunk mappings;
* one quota transition;
* one metadata job;
* one create audit event.

## Database migrations

Production migrations are forward-only.

Migration versions must be sequential and append-only.

Destructive operations require explicit review.

Never rewrite a migration that may already have been applied to a deployed
database. Add a new forward migration instead.

## Secrets

The following values must never enter logs, audit metadata, metrics, API
responses, or jobs:

* plaintext passwords;
* raw session tokens;
* TOTP secrets;
* plaintext recovery codes after issuance;
* encryption master key;
* Discord bot tokens;
* database credentials.

TOTP secrets are encrypted using the application master key.

The master key must be backed up separately from PostgreSQL.

## Observability

Metrics labels must remain bounded.

Do not use resource IDs, usernames, filenames, public IDs, upload IDs, or job
IDs as metric labels.

HTTP access logs use registered route patterns rather than raw paths.

Tracing IDs are diagnostic identifiers and are not authorization credentials.

## Security regression requirements

Release candidates must pass:

```text
go test -race ./...
```

and the dedicated concurrency tests.

Fuzz targets must cover at least:

* byte-range parsing;
* archive path sanitization;
* node name normalization;
* MIME parsing/fallback;
* cursor decoding.

Any fuzz-discovered corpus that caused a panic or invariant violation must be
kept as a regression corpus/test.

## Recovery

A PostgreSQL backup alone is not a complete physical data backup.

Restoration also depends on:

* the original encryption master key;
* Discord bot/channel configuration;
* continued existence of committed Discord attachment messages.

Restore rehearsals must validate both database state and representative
Discord-backed downloads.