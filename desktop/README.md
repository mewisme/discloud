# DisCloud Desktop

Native DisCloud client built with React, Vite, Tauri 2 and Rust. It shares the same workspace model as Web, then adds direct operating-system integration for transfers, sync, thumbnails, notifications and updates.

## Quick start

Install repository dependencies from the monorepo root:

```bash
pnpm install
```

Install Rust stable and the platform-specific Tauri prerequisites, then start the native app:

```bash
pnpm desktop:tauri dev
```

The frontend development server runs on `http://127.0.0.1:5173` and is opened inside the Tauri WebView.

## Connect to a server

Desktop is not tied to one deployment. On first launch it asks for a DisCloud server URL, validates the connection and stores the selected server for later sessions.

The same client supports:

- fresh-server setup
- username/password login
- MFA verification
- forced password change
- switching to another self-hosted server
- persistent authenticated sessions managed through the native API bridge

## Main capabilities

### Shared workspace

- Files and hierarchical folders
- File details, previews and version history
- Search
- Favorites
- Collections
- Resources shared directly with the current user
- Recent activity
- Storage analyzer
- Trash and restore workflows
- Profile, security and common workspace settings
- Public-share creation and management

### Desktop-native

- Native upload queue for files and folders
- Native download queue with retry, cancel, remove and reveal-in-file-manager actions
- Direct chunk downloads using short-lived Discord CDN URLs resolved by the backend
- Local folder synchronization
- Sync-pair configuration and scheduled sync execution
- Sync conflict detection and conflict center
- Native local-path opening
- Native thumbnail protocol with OS/FFmpeg-backed generation
- Drag-and-drop filesystem access
- System tray and close-to-tray behavior
- Single-instance handling
- Native notifications
- Autostart support
- Signed application updates with stable, RC, beta and alpha channels
- Desktop diagnostics and log export

See [../FEATURES.md](../FEATURES.md) for the complete implemented feature inventory and current wiring status.

## Architecture

```text
React + React Router
        |
        | Tauri invoke / custom protocols
        v
Rust native runtime
        |
        +-- authenticated HTTP transport --> DisCloud backend
        +-- uploads/downloads
        +-- local folder sync
        +-- thumbnails
        +-- filesystem/dialog APIs
        +-- tray/notifications/autostart
        +-- signed updater
```

The WebView does not directly receive unrestricted filesystem or remote-network access. Native commands validate paths and proxy server operations through the Rust layer.

## Source layout

```text
src/
  components/             Desktop shell, session and connection UI
  features/files/         File browser and file details
  features/uploads/       Native upload queue
  features/downloads/     Native download queue
  features/sync/          Sync configuration and conflict UI
  features/settings/      Shared and Desktop-specific settings
  features/updater/       Update settings and provider
  features/admin/         Desktop administration modules
  lib/                    API transport, auth and instance helpers
  router.tsx              Desktop route tree

src-tauri/src/
  api/                    Native authenticated API session
  commands/               Tauri command facade
  diagnostics/            Native diagnostics and logs
  runtime/                Window, tray and Desktop runtime behavior
  settings/               Native transfer/runtime settings
  sync/                   Sync engine, validation and filesystem grants
  thumbnails/             Native thumbnail service and protocol
  transfers/              Upload/download engines and file protocol
  updater/                Signed updater commands
  path_security.rs        Filesystem path validation
```

## Shared packages

Desktop consumes all shared workspace packages:

| Package | Responsibility |
| --- | --- |
| `@discloud/api` | Typed backend models and contracts |
| `@discloud/app-ui` | Cross-client product UI |
| `@discloud/shared` | Shared navigation, formatting and browser logic |
| `@discloud/ui` | UI primitives and global styles |

Desktop-specific screens wrap or extend the shared UI where native APIs are required.

## Scripts

Run from `desktop/`:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Vite frontend only |
| `pnpm build` | Type-check and build the frontend |
| `pnpm preview` | Preview the Vite production build |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Run ESLint with fixes |
| `pnpm typecheck` | Run TypeScript without emitting files |
| `pnpm test` | Run Vitest once |
| `pnpm test:watch` | Run Vitest in watch mode |
| `pnpm tauri` | Run the Tauri CLI |

Common root commands:

```bash
pnpm desktop:dev
pnpm desktop:build
pnpm desktop:lint
pnpm desktop:typecheck
pnpm desktop:test
pnpm desktop:tauri dev
```

Rust checks:

```bash
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path desktop/src-tauri/Cargo.toml --locked
cargo test --manifest-path desktop/src-tauri/Cargo.toml --locked
```

## FFmpeg sidecar

Release builds bundle FFmpeg as a Tauri external binary. The release workflow prepares the correct binary for each target before the Tauri bundle step:

```text
x86_64-unknown-linux-gnu
x86_64-pc-windows-msvc
aarch64-apple-darwin
x86_64-apple-darwin
```

FFmpeg is used as a fallback/native media helper for Desktop thumbnail workflows where direct OS support is not sufficient.

## Updates

The Tauri updater is configured in `src-tauri/tauri.conf.json` and release-specific values are injected by the release workflow.

Channels:

| Channel | Receives |
| --- | --- |
| Stable | Stable releases |
| RC | RC and newer stable releases |
| Beta | Beta, RC and newer stable releases |
| Alpha | Alpha, beta, RC and newer stable releases |

Release signing uses:

```text
TAURI_SIGNING_PUBLIC_KEY
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Only the private key and password are secrets. Never commit the private key.

## Current routing note

The Desktop codebase already contains administration modules for users, quotas, bot runtime and diagnostics. The current router still renders placeholders for `/admin`, `/admin/bots` and `/admin/diagnostics`, so those modules should not be treated as fully exposed Desktop routes until the router is wired to them.

## Related documentation

- [Repository README](../README.md)
- [Complete feature inventory](../FEATURES.md)
- [Security](../docs/SECURITY.md)
- [Release checklist](../docs/RELEASE_CHECKLIST.md)
- [`@discloud/app-ui`](../packages/app-ui/README.md)
