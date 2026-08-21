<div align="center">

<h1>DisCloud</h1>

<p>Self-hosted multi-user file storage backed by Discord attachments and PostgreSQL.</p>

[![CI](https://img.shields.io/github/actions/workflow/status/mewisme/discloud/ci.yml?branch=main&label=CI&logo=github)](https://github.com/mewisme/discloud/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mewisme/discloud?display_name=tag&sort=semver&logo=github)](https://github.com/mewisme/discloud/releases)
[![Backend](https://img.shields.io/badge/GHCR-dcbe-2496ED?logo=docker&logoColor=white)](https://github.com/mewisme/discloud/pkgs/container/dcbe)
[![Frontend](https://img.shields.io/badge/GHCR-dcfe-2496ED?logo=docker&logoColor=white)](https://github.com/mewisme/discloud/pkgs/container/dcfe)
[![Go](https://img.shields.io/github/go-mod/go-version/mewisme/discloud?logo=go)](go.mod)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](web)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)](compose.yml)

</div>

## About

DisCloud stores canonical application state in PostgreSQL and uses Discord
attachments as physical blob storage.

The backend includes hierarchical folders, ACLs, resumable uploads, chunk
deduplication, Range downloads, Trash/restore, collections, public shares,
search, MFA, quotas, metrics, jobs, and administrative diagnostics.

Discord storage uses a shared bot pool with:

- runtime capacity derived from usable bots;
- one active Discord operation lease per bot;
- fair scheduling between competing operation classes;
- automatic cooldown handling after Discord rate limits;
- adaptive browser part-upload concurrency;
- adaptive per-session chunk sizing;
- realtime administrator bot diagnostics and runtime controls.

The web client lives in `web/` and provides the user and administrator
interfaces for DisCloud.

## Quick start

Requirements:

- Docker and Docker Compose
- a Discord guild and storage channel
- one or more Discord bot tokens

Create the environment file:

```bash
cp .env.example .env
```

Generate the application encryption key:

```bash
openssl rand -base64 32
```

Set these values in `.env`:

```text
DISCLOUD_ENCRYPTION_MASTER_KEY_BASE64
DISCLOUD_DISCORD_GUILD_ID
DISCLOUD_DISCORD_CHANNEL_ID
DISCLOUD_DISCORD_BOT_TOKENS
```

Start the prebuilt images:

```bash
docker compose pull
docker compose up -d --no-build
```

Or build the backend and web images from source:

```bash
docker compose up -d --build
```

The web client is available on:

```text
http://localhost:3000
```

The API listens on:

```text
http://localhost:8080
```

Check readiness:

```text
GET /readyz
```

On a new installation, create the first administrator through:

```text
POST /api/v1/setup
```

## Development

Backend:

```bash
docker compose up -d postgres

export DISCLOUD_TEST_DATABASE_DSN="postgres://discloud:discloud@localhost:5432/discloud?sslmode=disable"

go test -race ./...
go vet ./...
go build ./cmd/discloud
```

Web:

```bash
cd web
pnpm install
pnpm dev
```

The development client runs on `http://localhost:3000`.

## Project layout

```text
cmd/          backend entrypoint
internal/     backend packages
migrations/   PostgreSQL migrations
web/          Next.js web client
desktop/      desktop client workspace
docs/         API, operations, benchmarking and security documentation
```

## Docker images

Published releases are available from:

Backend:

```text
ghcr.io/mewisme/dcbe
```

Frontend:

```text
ghcr.io/mewisme/dcfe
```

Every release tag publishes both the exact Git tag and `latest` for both images:

```text
ghcr.io/mewisme/dcbe:v1.2.3
ghcr.io/mewisme/dcbe:latest

ghcr.io/mewisme/dcfe:v1.2.3
ghcr.io/mewisme/dcfe:latest
```

For reproducible deployments, replace the `latest` tags in `compose.yml` with
the same exact release tag for both images.

## Releases

Releases are tag-driven:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GoReleaser creates the GitHub Release, binary archives, checksums, and the
multi-platform backend image. The release workflow also builds and publishes
the multi-platform web image using the same release tag.

## Documentation

* [OpenAPI](docs/openapi.json)
* [Operations](docs/OPERATIONS.md)
* [Storage benchmarking](docs/BENCHMARKING.md)
* [Security](docs/SECURITY.md)
* [Release checklist](docs/RELEASE_CHECKLIST.md)