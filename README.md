<div align="center">

# DisCloud

Self-hosted multi-user file storage backed by PostgreSQL and Discord attachments.

[![CI](https://img.shields.io/github/actions/workflow/status/mewisme/discloud/ci.yml?branch=main&label=CI&logo=github)](https://github.com/mewisme/discloud/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mewisme/discloud?display_name=tag&sort=semver&logo=github)](https://github.com/mewisme/discloud/releases)
[![Backend](https://img.shields.io/badge/GHCR-discloud--backend-2496ED?logo=docker&logoColor=white)](https://github.com/mewisme/discloud/pkgs/container/discloud-backend)
[![Frontend](https://img.shields.io/badge/GHCR-discloud--frontend-2496ED?logo=docker&logoColor=white)](https://github.com/mewisme/discloud/pkgs/container/discloud-frontend)
[![Go](https://img.shields.io/github/go-mod/go-version/mewisme/discloud?logo=go)](go.mod)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](web)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](desktop)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)](compose.yml)

</div>

## What is DisCloud?

DisCloud is a self-hosted file workspace with Web and native Desktop clients. PostgreSQL is the canonical source of users, metadata, permissions and application state; Discord attachments provide the physical blob storage layer.

The project includes hierarchical files and folders, chunked uploads, sharing, search, collections, file versions, MFA, administration, storage diagnostics and native Desktop workflows such as local folder sync and transfer queues.

See [FEATURES.md](FEATURES.md) for the complete implemented feature inventory.

## Project map

| Project | Purpose | Documentation |
| --- | --- | --- |
| Backend | Go API, storage coordination, background workers and PostgreSQL state | This README |
| Web | Next.js browser client and public share viewer | [web/README.md](web/README.md) |
| Desktop | Tauri + React native client | [desktop/README.md](desktop/README.md) |
| `@discloud/api` | Generated OpenAPI types and API contracts | [packages/api/README.md](packages/api/README.md) |
| `@discloud/app-ui` | Product-level UI shared by Web and Desktop | [packages/app-ui/README.md](packages/app-ui/README.md) |
| `@discloud/shared` | Framework-neutral shared utilities | [packages/shared/README.md](packages/shared/README.md) |
| `@discloud/ui` | Reusable UI primitives and global styles | [packages/ui/README.md](packages/ui/README.md) |

## Quick start

### Requirements

- Docker with Docker Compose
- A Discord guild and storage channel
- One or more Discord bot tokens that can access the storage channel

### Recommended Discord bot count

DisCloud can run with a single usable Discord bot, but **4 usable bots is the recommended starting point** for a normal self-hosted deployment. Each usable bot contributes at most one active Discord lease, so additional bots increase the scheduler's available concurrency and provide headroom when individual bots are cooling down.

| Usable bots | Guidance |
| --- | --- |
| `1` | Minimum; suitable for development or very light use |
| `2` | Light personal use |
| `4` | Recommended starting point |
| `8+` | Higher-throughput deployments; benchmark and monitor Discord rate limits before scaling further |

The effective pool can temporarily be smaller than the configured pool when bots are unavailable or rate-limited. Use the admin bot runtime view or `GET /api/v1/admin/bots` to inspect current capacity. See [docs/BENCHMARKING.md](docs/BENCHMARKING.md) for the bot-count benchmark procedure.

Clone the repository and create the environment file:

```bash
git clone https://github.com/mewisme/discloud.git
cd discloud
cp .env.example .env
```

Generate the required 32-byte encryption key with either OpenSSL or Node.js:

```bash
# OpenSSL
openssl rand -base64 32

# Node.js
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Set at least these values in `.env`:

```env
DISCLOUD_ENCRYPTION_MASTER_KEY_BASE64=
DISCLOUD_DISCORD_GUILD_ID=
DISCLOUD_DISCORD_CHANNEL_ID=
DISCLOUD_DISCORD_BOT_TOKENS=
```

Start DisCloud:

```bash
docker compose pull
docker compose up -d --no-build
```

Open `http://localhost:3000`. A fresh installation redirects to `/setup`, where the first administrator account is created.

### Build containers locally

```bash
docker compose up -d --build
```

## Release channels

`compose.yml` uses the stable Docker tag by default for both backend and Web images:

```env
DISCLOUD_DOCKER_TAG=latest
```

Supported values:

| Value | Meaning |
| --- | --- |
| `latest` | Latest stable release |
| `rc` | Latest release candidate |
| `beta` | Latest beta |
| `alpha` | Latest alpha |
| `vX.Y.Z...` | Exact immutable release |

For reproducible deployments, pin an exact `v*` tag. The default `latest` tag follows stable releases.

Published images:

```text
ghcr.io/mewisme/discloud-backend
ghcr.io/mewisme/discloud-frontend
```

## Configuration

The complete server configuration is documented inline in [.env.example](.env.example). The main groups are:

- HTTP, public URL, trusted proxies and CORS
- PostgreSQL connection pooling
- authentication cookies and session lifetime
- MFA issuer and encryption master key
- Discord guild, channel and bot pool
- normal and media upload chunk sizing
- background worker count
- structured log level

Before exposing an instance publicly, review cookie security, public URLs, allowed origins, reverse-proxy settings and database credentials.

## Development

### Requirements

- Go version declared in [go.mod](go.mod)
- Node.js 24+
- pnpm version declared in [package.json](package.json)
- PostgreSQL 18 for integration tests
- Rust stable and Tauri prerequisites when working on Desktop

Install JavaScript workspace dependencies once from the repository root:

```bash
pnpm install
```

### Backend

Start PostgreSQL:

```bash
docker compose up -d postgres
```

Set the integration-test database DSN:

```bash
export DISCLOUD_TEST_DATABASE_DSN="postgres://discloud:discloud@localhost:5432/discloud?sslmode=disable"
```

Run the backend checks:

```bash
gofmt -w .
go vet ./...
go test -race ./...
go build ./cmd/discloud
```

Run the server with the variables from `.env` loaded into your shell:

```bash
go run ./cmd/discloud
```

The API listens on `:8080` by default.

### Web

```bash
cp web/.env.example web/.env.local
pnpm web:dev
```

Open `http://localhost:3000`. See [web/README.md](web/README.md) for the Web architecture and deployment options.

### Desktop

```bash
pnpm desktop:tauri dev
```

See [desktop/README.md](desktop/README.md) for native prerequisites, architecture, sync, transfers and updater details.

## Common checks

Backend:

```bash
go vet ./...
go test -race ./...
```

JavaScript workspace:

```bash
pnpm api:types:check
pnpm api:typecheck
pnpm shared:typecheck
pnpm ui:typecheck
pnpm app-ui:typecheck
pnpm web:lint
pnpm web:typecheck
pnpm web:test
pnpm desktop:lint
pnpm desktop:typecheck
pnpm desktop:test
```

Desktop Rust:

```bash
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path desktop/src-tauri/Cargo.toml --locked
cargo test --manifest-path desktop/src-tauri/Cargo.toml --locked
```

## Releases

A release is created from a `v*` Git tag. Release automation publishes the backend archives and container image, the multi-platform Web image, Linux standalone Web archives, Tauri installers, updater manifests and checksums.

Web standalone artifacts:

```text
discloud-web_<version>_linux_amd64.tar.gz
discloud-web_<version>_linux_arm64.tar.gz
discloud-web-checksums.txt
```

Desktop update channels:

| Channel | Receives |
| --- | --- |
| Stable | Stable releases |
| RC | RC and newer stable releases |
| Beta | Beta, RC and newer stable releases |
| Alpha | Alpha, beta, RC and newer stable releases |

Stable uses the `latest.json` attached to the latest stable release. Mutable `rc.json`, `beta.json` and `alpha.json` manifests live on the dedicated `updater-channels` prerelease.

## Documentation

- [Feature inventory](FEATURES.md)
- [OpenAPI contract](docs/openapi.json)
- [Operations](docs/OPERATIONS.md)
- [Security](docs/SECURITY.md)
- [Storage benchmarking](docs/BENCHMARKING.md)

## Repository layout

```text
cmd/discloud/        Backend entry point
internal/            Backend services and HTTP API
migrations/          Embedded PostgreSQL migrations
docs/                API and operational documentation
web/                 Next.js client
desktop/             Tauri desktop client
packages/api/        Shared API contracts
packages/app-ui/     Shared product UI
packages/shared/     Shared framework-neutral utilities
packages/ui/         Shared UI primitives
scripts/             Release and native-sidecar helpers
.github/workflows/   CI and release workflows
```

## License

DisCloud is licensed under the [MIT License](LICENSE).
