<div align="center">

<h1>DisCloud</h1>

<p>Self-hosted multi-user file storage backed by Discord attachments and PostgreSQL.</p>

[![CI](https://img.shields.io/github/actions/workflow/status/mewisme/discloud/ci.yml?branch=main&label=CI&logo=github)](https://github.com/mewisme/discloud/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mewisme/discloud?display_name=tag&sort=semver&logo=github)](https://github.com/mewisme/discloud/releases)
[![Backend](https://img.shields.io/badge/GHCR-dcbe-2496ED?logo=docker&logoColor=white)](https://github.com/mewisme/discloud/pkgs/container/dcbe)
[![Frontend](https://img.shields.io/badge/GHCR-dcfe-2496ED?logo=docker&logoColor=white)](https://github.com/mewisme/discloud/pkgs/container/dcfe)
[![Desktop Updater](https://img.shields.io/badge/Updater-latest.json-24C8DB?logo=tauri&logoColor=white)](https://github.com/mewisme/discloud/releases/latest/download/latest.json)
[![Go](https://img.shields.io/github/go-mod/go-version/mewisme/discloud?logo=go)](go.mod)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](web)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)](compose.yml)

</div>

## Overview

DisCloud is a self-hosted file storage application that keeps application state and metadata in PostgreSQL while using Discord attachments as blob storage.

It provides web and desktop interfaces for managing personal and shared files, together with administration and diagnostics for the underlying storage system.

### Features

- Multi-user workspaces with hierarchical files and folders
- Resumable and chunked uploads with deduplication
- File previews, downloads and HTTP Range support
- Search, favorites, collections and Trash
- Folder and collection sharing with access control
- Public file, folder and collection shares
- Multiple Discord storage bots with adaptive upload concurrency
- MFA, storage quotas and session management
- Administration for users, bots, jobs and runtime diagnostics
- Native desktop client with tray integration, notifications and signed updates

## Architecture

| Component | Purpose |
| --- | --- |
| **Web** | Next.js user and administration interface |
| **Desktop** | Tauri native desktop client and signed updater |
| **Backend** | Go API, storage coordination and background jobs |
| **PostgreSQL** | Users, metadata, permissions and application state |
| **Discord** | Physical chunk and attachment storage |

PostgreSQL remains the canonical source of application state. Discord is used only for physical blob storage.

## Quick start

### Requirements

- Docker with Docker Compose
- A Discord guild and storage channel
- One or more Discord bot tokens with access to the storage channel

Clone the repository and create the environment file:

```bash
git clone https://github.com/mewisme/discloud.git
cd discloud
cp .env.example .env
```

Generate a 32-byte encryption key:

```bash
openssl rand -base64 32
```

Configure at least these values in `.env`:

```env
DISCLOUD_ENCRYPTION_MASTER_KEY_BASE64=
DISCLOUD_DISCORD_GUILD_ID=
DISCLOUD_DISCORD_CHANNEL_ID=
DISCLOUD_DISCORD_BOT_TOKENS=
```

Pull and start the containers:

```bash
docker compose pull
docker compose up -d --no-build
```

Open:

```text
http://localhost:3000
```

A new installation will guide you through creating the first administrator at `/setup`.

### Build from source

To build the backend and frontend images locally instead:

```bash
docker compose up -d --build
```

## Configuration

The complete backend configuration is documented in `.env.example`.

The most important groups are:

* HTTP and CORS
* PostgreSQL
* authentication and MFA
* encryption
* Discord storage
* upload and chunk sizing
* background workers
* logging

For production deployments, review cookie security, public URLs, CORS origins and database credentials before exposing the instance publicly.

## Docker images

Multi-platform images are published to GitHub Container Registry:

```text
ghcr.io/mewisme/dcbe
ghcr.io/mewisme/dcfe
```

Every release publishes its exact Git tag together with a release channel:

| Git tag | Channel |
| --- | --- |
| `v1.0.0` | `latest` |
| `v1.1.0-alpha.1` | `alpha` |
| `v1.1.0-beta.1` | `beta` |
| `v1.1.0-rc.1` | `rc` |

For example:

```text
ghcr.io/mewisme/dcbe:v1.1.0-beta.1
ghcr.io/mewisme/dcbe:beta

ghcr.io/mewisme/dcfe:v1.1.0-beta.1
ghcr.io/mewisme/dcfe:beta
```

`compose.yml` uses `DISCLOUD_DOCKER_TAG` for both images and currently defaults to the `rc` channel. Set it to `latest`, `alpha`, `beta`, `rc`, or an exact `v*` release tag.

For reproducible deployments, set `DISCLOUD_DOCKER_TAG` to an exact release tag so both images stay on the same version.

## Web standalone releases

GitHub Releases also include Node.js standalone Web runtimes for Linux `amd64` and `arm64`:

```text
discloud-web_<version>_linux_amd64.tar.gz
discloud-web_<version>_linux_arm64.tar.gz
discloud-web-checksums.txt
```

They require Node.js 24 or newer. Extract the archive, configure the same runtime environment used by the container, then start `node web/server.js`.

## Desktop releases

Desktop installers and updater artifacts are attached to the same GitHub Release as the backend archives. Each exact release contains its own signed `latest.json`, and every download URL inside that manifest points back to the exact Git tag that produced it.

Desktop users choose their update channel in **Settings > Desktop > Updates**:

| Desktop channel | Receives |
| --- | --- |
| Stable | Stable releases only |
| Release candidate | RC and newer stable releases |
| Beta | Beta, RC and newer stable releases |
| Alpha | Alpha, beta, RC and newer stable releases |

Stable uses `releases/latest/download/latest.json`. The mutable `rc.json`, `beta.json` and `alpha.json` channel pointers are stored on the dedicated `updater-channels` prerelease and are advanced only when a compatible newer release is published.

Desktop release signing requires these GitHub Actions secrets:

```text
TAURI_SIGNING_PUBLIC_KEY
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

The private signing key must never be committed to the repository.

## Development

### Backend

Start PostgreSQL:

```bash
docker compose up -d postgres
```

Set the test database:

```bash
export DISCLOUD_TEST_DATABASE_DSN="postgres://discloud:discloud@localhost:5432/discloud?sslmode=disable"
```

Run the backend checks:

```bash
go test -race ./...
go vet ./...
go build ./cmd/discloud
```

### Web

```bash
cd web
pnpm install
pnpm dev
```

The development server runs at `http://localhost:3000`.

### Desktop

```bash
pnpm install
pnpm desktop:tauri dev
```

Before a release, validate both frontend and native desktop code:

```bash
pnpm desktop:lint
pnpm desktop:typecheck
pnpm desktop:build
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path desktop/src-tauri/Cargo.toml --locked
cargo test --manifest-path desktop/src-tauri/Cargo.toml --locked
```

## Documentation

* [OpenAPI](docs/openapi.json)
* [Operations](docs/OPERATIONS.md)
* [Security](docs/SECURITY.md)
* [Storage benchmarking](docs/BENCHMARKING.md)
* [Release checklist](docs/RELEASE_CHECKLIST.md)

## License

DisCloud is licensed under the [MIT License](LICENSE).
