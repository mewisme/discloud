# DisCloud Web

Next.js 16 browser client for DisCloud. It provides the complete browser workspace, public share viewer, administration surfaces and downloadable Desktop release information.

## Quick start

From the repository root:

```bash
pnpm install
cp web/.env.example web/.env.local
pnpm web:dev
```

Start the backend separately, then open:

```text
http://localhost:3000
```

Default development configuration:

```env
DISCLOUD_API_URL=http://127.0.0.1:8080
DISCLOUD_PUBLIC_API_URL=http://localhost:8080
```

## Environment

| Variable | Used for |
| --- | --- |
| `DISCLOUD_API_URL` | Server-side backend origin used by the same-origin API proxy and server code |
| `DISCLOUD_PUBLIC_API_URL` | Backend origin exposed to browser runtime configuration when a direct public URL is required |

Browser API calls normally use `/api/backend/*`, so backend cookies and requests stay behind the Web origin instead of hard-coding a backend URL into every client request.

## Main capabilities

- Initial instance setup, login, MFA verification and forced password changes
- Multi-user workspace navigation
- Hierarchical file and folder browser with grid/list layouts
- Multi-selection, create, rename, move, favorite and Trash actions
- Chunked upload queue with folder uploads and adaptive concurrency
- File preview, thumbnail loading and version history
- Search with filters, sorting and pagination
- Favorites and collections
- Direct shares and public file/folder/collection shares
- Password-protected public share viewer
- Recent activity and storage analyzer
- Profile, avatar, security and common workspace settings
- MFA enrollment and recovery-code management
- Administration for users, quotas, Discord bot runtime and diagnostics
- Desktop release/download discovery
- Theme switching, command palette, network status and workspace switching

See [../FEATURES.md](../FEATURES.md) for the complete cross-component feature inventory.

## Routes

Important route groups:

```text
/                         Public landing page
/features                 Web/Desktop feature matrix
/login                    Authentication
/setup                    First-server setup
/change-password          Forced password change
/s/:publicId              Public share viewer
/:username                Workspace root
/:username/folders/*      Folder browser
/:username/files/*        File details
/:username/search         Search
/:username/favorites      Favorites
/:username/collections    Collections
/:username/shared         Shared resources
/:username/activity       Recent activity
/:username/storage        Storage analyzer
/:username/trash          Trash
/:username/uploads        Upload manager
/:username/settings/*     User settings
/:username/admin/*        Administration
```

## Architecture

```text
Browser
  |
  | same-origin requests
  v
Next.js App Router
  |
  | /api/backend/* proxy + server API helpers
  v
DisCloud backend
```

The Web app consumes the shared workspace packages directly:

| Package | Responsibility |
| --- | --- |
| `@discloud/api` | API models, generated OpenAPI types and transport contracts |
| `@discloud/app-ui` | Product-level shared views and forms |
| `@discloud/shared` | Framework-neutral navigation, formatting and file-browser utilities |
| `@discloud/ui` | UI primitives and global design-system styles |

## Source layout

```text
src/app/                 Next.js routes, layouts and route handlers
src/components/app/      Application shell and workspace context
src/components/files/    File browser, previews and node actions
src/components/uploads/  Browser upload manager
src/components/shares/   Public and authenticated sharing UI
src/components/admin/    User, bot and diagnostics administration
src/components/settings/ Profile, security and common settings
src/lib/api/             API client/server helpers and contracts
src/lib/files/           File browser/navigation helpers
src/lib/uploads/         Upload planning, queues and concurrency
src/lib/releases/        Desktop release discovery
```

## Scripts

Run from `web/`:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start Next.js development server |
| `pnpm build` | Build the production standalone app |
| `pnpm start` | Start a standard Next.js production build |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Run ESLint with fixes |
| `pnpm typecheck` | Run TypeScript without emitting files |
| `pnpm typegen` | Generate Next.js route types |
| `pnpm test` | Run Vitest once |
| `pnpm test:watch` | Run Vitest in watch mode |
| `pnpm api:types` | Regenerate `@discloud/api` OpenAPI types |
| `pnpm api:types:check` | Verify generated API types are current |

Equivalent root commands include `pnpm web:dev`, `pnpm web:build`, `pnpm web:lint`, `pnpm web:typecheck` and `pnpm web:test`.

## Production

### Container image

The release pipeline publishes the Web image as:

```text
ghcr.io/mewisme/discloud-frontend:<tag>
```

`web/Dockerfile` uses the Next.js standalone output and a multi-stage build. Release builds target Linux `amd64` and `arm64`.

### Standalone archive

Releases also publish standalone Node.js archives for Linux `amd64` and `arm64`. Node.js 24+ is required.

After extracting an archive and setting the runtime environment:

```bash
node web/server.js
```

## API contract

The backend contract is maintained at [../docs/openapi.json](../docs/openapi.json). Generated TypeScript types live in [`@discloud/api`](../packages/api/README.md).

Before changing an API-dependent Web feature, update the OpenAPI contract first when necessary, regenerate the API package, then run:

```bash
pnpm api:types:check
pnpm web:typecheck
pnpm web:test
```

## Related documentation

- [Repository README](../README.md)
- [Complete feature inventory](../FEATURES.md)
- [`@discloud/api`](../packages/api/README.md)
- [`@discloud/app-ui`](../packages/app-ui/README.md)
- [`@discloud/shared`](../packages/shared/README.md)
- [`@discloud/ui`](../packages/ui/README.md)
