# DisCloud

DisCloud is a self-hosted multi-user file storage backend that uses Discord
attachments as physical blob storage while keeping canonical application state
in PostgreSQL.

The backend provides:

- password and session authentication;
- optional TOTP MFA and recovery codes;
- per-user logical storage quotas;
- hierarchical folders;
- inherited folder permissions;
- collections and collection permissions;
- resumable chunked uploads;
- chunk deduplication;
- HTTP Range downloads;
- recursive folder ZIP downloads;
- Trash and restore;
- public file, folder, and collection shares;
- favorites and permission-aware search;
- MIME and media metadata;
- administrative diagnostics;
- Prometheus-compatible metrics;
- background jobs and technical orphan cleanup.

## Architecture

```text
Client
  |
  v
DisCloud HTTP API
  |
  +--------------------+
  |                    |
  v                    v
PostgreSQL           Discord
canonical state      attachment blobs
```

PostgreSQL is canonical for users, nodes, permissions, quotas, file metadata,
chunk locators, uploads, jobs, audit events, collections, and shares.

Discord contains the physical bytes for committed chunks.

Committed chunks are not physically deleted by normal product lifecycle.

## Requirements

For source development:

```text
Go 1.26.5
PostgreSQL 18
Docker / Docker Compose optional
```

For normal Docker deployment:

```text
Docker
Docker Compose
Discord guild
Discord channel
one or more Discord bot tokens
```

All storage bots must be able to access the same configured Discord channel.

## Quick start with Docker Compose

Copy the example environment:

```powershell
Copy-Item .env.example .env
```

Generate a 32-byte application encryption master key:

```powershell
openssl rand -base64 32
```

Put the result in:

```text
DISCLOUD_ENCRYPTION_MASTER_KEY_BASE64
```

Configure:

```text
DISCLOUD_DISCORD_GUILD_ID
DISCLOUD_DISCORD_CHANNEL_ID
DISCLOUD_DISCORD_BOT_TOKENS
```

Then start DisCloud:

```powershell
docker compose pull backend
docker compose up -d
```

The default API address is:

```text
http://localhost:8080
```

PostgreSQL is exposed only on loopback by the default Compose configuration.

## Build from source with Compose

The Compose backend service contains both an `image` and a local `build`
definition.

Build the current source tree instead of using the prebuilt GHCR image:

```powershell
docker compose up -d --build
```

## Pin a released image

For reproducible deployments, prefer an exact release tag:

```powershell
$env:DISCLOUD_IMAGE="ghcr.io/mewisme/discloud:v1.2.3"

docker compose pull backend
docker compose up -d
```

The moving image:

```text
ghcr.io/mewisme/discloud:latest
```

tracks the most recently published tag.

## First-time setup

After the backend is ready, the installation initially has no users.

Check setup state:

```http
GET /api/v1/setup/status
```

Create the first administrator:

```http
POST /api/v1/setup
Content-Type: application/json
```

```json
{
  "username": "admin",
  "password": "choose-a-strong-password"
}
```

Only the initial setup endpoint creates the first administrator.

There is no public user registration.

Additional users are created by an administrator.

## Health

Liveness:

```http
GET /healthz
```

Readiness:

```http
GET /readyz
```

A healthy readiness response is:

```text
204 No Content
```

Readiness requires PostgreSQL and initialized Discord storage.

## Configuration

Runtime configuration is environment-variable based.

See:

```text
.env.example
```

Important production settings include:

```text
DISCLOUD_PUBLIC_BASE_URL
DISCLOUD_DATABASE_DSN
DISCLOUD_AUTH_COOKIE_SECURE
DISCLOUD_AUTH_COOKIE_SAME_SITE
DISCLOUD_ENCRYPTION_MASTER_KEY_BASE64
DISCLOUD_DISCORD_GUILD_ID
DISCLOUD_DISCORD_CHANNEL_ID
DISCLOUD_DISCORD_BOT_TOKENS
```

For HTTPS deployments:

```text
DISCLOUD_AUTH_COOKIE_SECURE=true
```

Do not rotate or lose the application encryption master key without a
deliberate migration. Existing encrypted TOTP secrets depend on it.

Never commit `.env`.

## Discord storage

Configured Discord bots are equal peers.

There is no primary, secondary, priority, or weighted storage bot.

Initial uploads use round-robin selection.

Retryable chunk failures move to another distinct bot.

Committed chunks store Discord channel/message/attachment locators rather than
the uploader bot identity, allowing any usable configured bot to read from the
shared channel.

Technical orphan cleanup only applies to old, uncommitted chunks.

Committed file chunks are not normal garbage-collection candidates.

## PostgreSQL

DisCloud targets PostgreSQL 18.

Migrations run automatically during application startup.

Production migrations are forward-only.

Do not modify a migration that may already have been deployed.

Create a new forward migration instead.

## Development

Start PostgreSQL:

```powershell
docker compose up -d postgres
```

Run tests:

```powershell
$env:DISCLOUD_TEST_DATABASE_DSN="postgres://discloud:discloud@localhost:5432/discloud?sslmode=disable"

go test -race ./...
```

Run vet:

```powershell
go vet ./...
```

Check formatting:

```powershell
gofmt -w .
```

Build:

```powershell
go build ./cmd/discloud
```

Build the container:

```powershell
docker build -t discloud:dev .
```

## API contract

The OpenAPI contract is stored at:

```text
docs/openapi.json
```

Supporting API catalogs are stored under:

```text
docs/openapi/
```

They include shared schemas, error/status documentation, and validated API
examples.

## Operational documentation

Operational runbook:

```text
docs/OPERATIONS.md
```

Security model:

```text
docs/SECURITY.md
```

Backend release gate:

```text
docs/RELEASE_CHECKLIST.md
```

## Admin diagnostics

Authenticated administrators can inspect:

```http
GET /api/v1/admin/audit
GET /api/v1/admin/jobs
GET /api/v1/admin/uploads
GET /api/v1/admin/storage
GET /api/v1/admin/metrics
```

Quota reconciliation:

```http
POST /api/v1/admin/storage/reconcile
```

## Backup

PostgreSQL contains canonical application state but does not contain Discord
attachment bytes.

A recoverable installation therefore requires all of:

```text
PostgreSQL backup
application encryption master key
Discord bot/channel configuration
continued existence of committed Discord messages
```

See:

```text
docs/OPERATIONS.md
```

for backup and restore procedures.

## Releases

Releases are tag-driven.

Push a semantic version tag:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

The release workflow verifies the tagged commit and then uses GoReleaser to
create the GitHub Release and publish the multi-platform GHCR image.

For tag:

```text
v1.2.3
```

the container tags are:

```text
ghcr.io/mewisme/discloud:v1.2.3
ghcr.io/mewisme/discloud:latest
```

Release container platforms:

```text
linux/amd64
linux/arm64
```

GitHub Release binary archives are built for:

```text
Linux amd64
Linux arm64
macOS amd64
macOS arm64
Windows amd64
Windows arm64
```

## Local GoReleaser validation

Install GoReleaser, then validate:

```powershell
$env:DISCLOUD_DOCKER_IMAGE="ghcr.io/mewisme/discloud"

goreleaser check
```

Create a local snapshot:

```powershell
goreleaser release --snapshot --clean
```

Snapshot releases do not publish the production GitHub Release.

## Release policy

A tag must not be treated as release-ready merely because it builds.

Before creating a production tag, complete:

```text
docs/RELEASE_CHECKLIST.md
```

including race tests, concurrency tests, fuzzing, load tests, migration review,
search-plan verification, and PostgreSQL restore rehearsal.