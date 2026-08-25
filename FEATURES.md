# DisCloud feature inventory

This document lists the capabilities currently represented by the backend API/services, Web routes/components and Desktop React/Rust runtime in this repository.

The inventory is intentionally implementation-oriented. It distinguishes fully wired product surfaces from native-only capabilities and code that exists but is not yet exposed through the current route tree.

## At a glance

| Capability | Backend | Web | Desktop |
| --- | --- | --- | --- |
| Initial server setup | Yes | Yes | Yes |
| Multi-user workspaces | Yes | Yes | Yes |
| Files and folders | Yes | Yes | Yes |
| Chunked/resumable uploads | Yes | Browser queue | Native queue |
| Downloads | Yes | Browser download | Native queue |
| File previews and range streaming | Yes | Yes | Yes |
| File version history | Yes | Yes | Yes |
| Search | Yes | Yes | Yes |
| Favorites | Yes | Yes | Yes |
| Collections | Yes | Yes | Yes |
| Trash/restore/permanent delete | Yes | Yes | Yes |
| Direct user sharing/ACL | Yes | Yes | Yes |
| Public shares | Yes | Create/manage/view | Create/manage |
| Password-protected public shares | Yes | Unlock/view | Manage share settings |
| Recent activity | Yes | Yes | Yes |
| Storage analyzer | Yes | Yes | Yes |
| Profile/avatar settings | Yes | Yes | Yes |
| MFA and recovery codes | Yes | Yes | Yes |
| Session management | Yes | Yes | Through shared account APIs |
| User/quota administration | Yes | Yes | Modules exist; routes not wired |
| Discord bot runtime administration | Yes | Yes | Modules exist; routes not wired |
| Runtime diagnostics | Yes | Yes | Native diagnostics available; admin route not wired |
| Local folder sync | Desktop support APIs | No | Native |
| Sync conflict center | Activity support | No | Native |
| Native upload/download manager | Desktop support APIs | No | Native |
| Local thumbnail generation | Thumbnail APIs | No | Native |
| Tray/autostart/notifications | No | No | Native |
| Signed updater channels | Release infrastructure | No | Native |

---

# Backend

The backend is a Go HTTP API backed by PostgreSQL. PostgreSQL stores canonical application state and permissions; Discord attachments store physical file chunks and direct objects such as thumbnails and avatars.

## System lifecycle

- Environment-based configuration with validation at startup.
- Automatic embedded PostgreSQL migrations.
- PostgreSQL connection pooling and health checks.
- Graceful HTTP shutdown.
- Structured logging with configurable log level.
- Startup readiness check covering database and Discord storage availability.
- `/healthz` liveness endpoint.
- `/readyz` readiness endpoint.
- UUIDv7-backed database identifiers through PostgreSQL migrations/defaults.

## Initial setup

- Detect whether first-run setup is required.
- Create the initial administrator account.
- Prevent normal login flow until setup is complete.
- Setup status API used by both Web and Desktop clients.

## Authentication and account security

- Username/password authentication.
- Argon2id password hashing.
- Minimum password policy for normal passwords.
- Temporary-password flow for administrator-created/reset accounts.
- Forced password change support.
- Cookie-backed server sessions.
- Configurable session TTL and cookie attributes.
- Logout.
- Current authenticated-user lookup.
- List active sessions.
- Revoke an individual session.
- Revoke all other sessions.
- Authentication rate limiting.
- CSRF protection for state-changing browser requests.
- CORS allow-list configuration.
- HTTP security middleware and request IDs.

## MFA

- TOTP MFA enrollment.
- TOTP enrollment confirmation.
- MFA challenge during login.
- Recovery-code generation and use.
- Recovery-code regeneration.
- Disable TOTP after verification/authorization.
- Administrator MFA reset for another user.
- Configurable MFA issuer.
- Encryption master key for sensitive MFA/application secrets.

## User profile and workspace identity

- Read/update current account profile.
- Immutable username-based workspace addressing.
- Exact active-user lookup by username.
- Workspace lookup by username.
- User display names.
- User avatars stored through the Discord-backed direct-object storage service.
- Avatar read/update/delete.
- Per-user storage usage information.
- Per-user workspace root lookup.

## User preferences

- Persisted per-user common configuration.
- Theme/appearance preferences.
- Sidebar preferences.
- File-browser layout preferences.
- File-preview preferences.
- Pagination preferences.
- Date/time and timezone preferences.
- Shared configuration consumed by both Web and Desktop.

## Administration: users

- List users with pagination/filtering inputs.
- Create users.
- Read a user.
- Update user metadata/role-related state supported by the API model.
- Read administrator-visible user avatars.
- Set or remove storage quotas.
- Reset a user's password to a temporary password.
- Force password change after reset/create workflows.
- Disable users.
- Re-enable users.
- Inspect per-user storage usage.
- Resolve a user's workspace root.
- Reset another user's MFA.

## Administration: runtime configuration

- List server configuration exposed to administrators.
- Read a configuration key.
- Set/update a configuration key.
- Delete/reset a configuration key.

## Files and folders

- Hierarchical folder tree.
- Create folders.
- Batch folder creation.
- Rename folders and files through node updates.
- Move nodes through node updates.
- Read folder metadata.
- List folder children.
- Breadcrumb resolution.
- Folder tree/path validation.
- Download an entire folder.
- Read file metadata.
- Stream file content.
- Download files as attachments.
- HTTP Range support for media/file streaming.
- File/folder metadata validation and safe naming rules.
- Concurrent node-operation protections backed by database transactions/constraints.

## Chunk storage and deduplication

- Files are split into chunks before physical storage.
- SHA-256 is recorded for chunks.
- Chunk identity is unique by `(sha256, size_bytes)`.
- Existing matching chunks can be reused instead of storing duplicate physical chunks.
- Chunks transition from uncommitted to ready state.
- Discord channel/message/attachment identity is persisted for every physical chunk.
- Canonical file metadata remains in PostgreSQL.

## Upload sessions

- Create an upload session.
- Inspect upload status.
- Cancel/delete an upload session.
- Upload parts independently by part index.
- Complete/finalize an upload.
- Resumable behavior through persisted upload/part state.
- Upload conflict detection.
- Concurrent upload protections.
- Configurable upload-session TTL.
- Automatic expiry worker for abandoned upload sessions.
- Separate normal-file and media chunk targets.
- Adaptive per-session chunk planning.
- Chunk sizing can shrink when more Discord bot capacity can be used effectively.
- Upload capacity checks against the current usable bot pool.
- Storage reservation/quota integration during uploads.

## Discord storage backend

- One configured Discord guild/channel storage target.
- Multiple Discord bot tokens in one runtime pool.
- Minimum runtime pool size: 1 usable bot; recommended starting point for normal self-hosted deployments: 4 usable bots.
- Larger pools such as 8+ bots are supported operationally, but should be scaled based on benchmark results and observed Discord rate-limit behavior.
- Runtime bot identity resolution.
- Degraded startup when only part of the configured bot pool is usable.
- Effective/available capacity tracking.
- Fair scheduling across available bots.
- Dynamic scheduling based on current runtime capacity.
- Upload leases/concurrency coordination.
- Bot runtime status snapshot.
- Real-time bot runtime events API.
- Probe/refresh a resolved bot.
- Probe/recover a bot by configuration index.
- Drain a bot and disable it after current work completes.
- Temporarily disable a bot.
- Re-enable a bot.
- Discord attachment deletion for garbage collection.
- Discord CDN URL resolution.
- CDN URL cache with expiration/safety window behavior.
- HTTP error classification and degraded-state handling.

## Direct objects

Direct objects are small Discord-backed objects separate from normal file chunks.

- SHA-256 digesting.
- Size limits.
- Object kinds for avatars, thumbnails and other direct objects.
- Discord attachment location persistence.
- Cached CDN URL persistence and refresh.
- Cleanup when database registration fails after Discord upload.
- Garbage collection for unreferenced direct objects.

## File metadata and media processing

- Background file metadata extraction.
- Image metadata processing.
- Video/media metadata support.
- Asynchronous metadata jobs.
- Metadata processing is decoupled from upload completion.

## Thumbnails

- Per-file thumbnail records.
- Thumbnail states: pending, ready, failed and skipped.
- Background thumbnail jobs.
- Read generated thumbnails.
- Upload/replace a thumbnail through the API.
- Thumbnail recovery/backfill migrations.
- Range-based source access so thumbnail generation does not require naive full-file reads in every path.

## File versions

- Immutable file-version history.
- List versions for a file.
- Download a specific historical version.
- Restore a historical version as a new current revision.
- Version metadata remains tied to the logical file.

## Favorites

- Mark a file/folder node as favorite.
- Remove favorite state.
- Favorites are available in workspace browsing/search surfaces.

## Trash

- Soft-delete files.
- Soft-delete folders.
- List Trash contents.
- Restore files.
- Restore folders.
- Permanently delete files.
- Permanently delete folders.
- Empty Trash.
- Purge logic coordinates database references and physical storage cleanup.

## Collections

- List collections.
- Create collections.
- Read collection metadata.
- Rename/update collections.
- Soft-delete collections.
- Restore collections.
- List collection items.
- Add files to a collection.
- Remove files from a collection.
- Owner-scoped collection behavior.
- Collection access control.

## Access control and direct sharing

- Folder-level ACL entries.
- Read folder permissions.
- Grant/update folder access for another user.
- Remove folder access.
- Collection-level access entries.
- Read collection access.
- Grant/update collection access.
- Remove collection access.
- Shared-resource listing for the current user.
- Permission-aware traversal for search and browsing.
- Server-enforced authorization across Web and Desktop clients.

## Public shares

- Create public shares for supported resources.
- Inspect the active public share for a resource.
- Update public-share access controls.
- Delete/revoke public shares.
- Public share IDs/routes independent from authenticated workspace routes.
- Public file metadata/view.
- Public file content streaming.
- Public file download.
- Public folder browsing.
- Public folder download.
- Public collection/item listing.
- File access inside public folder/collection shares.
- Password-protected shares.
- Unlock flow with public-share sessions.
- Revoke all password sessions for a public share.
- Public-share rate/usage limit middleware where configured by the share service.

## Search

- Workspace search API.
- Permission-aware search results.
- Search planning/index support in PostgreSQL migrations.
- Query input validation.
- Filters/options consumed by the shared clients.
- Pagination support.

## Recent activity

- Recent workspace activity feed.
- Records file/workspace operations represented by the activity service.
- Desktop sync completion can be recorded through `/api/v1/activity/sync`.

## Storage analyzer

- Workspace storage analysis endpoint.
- Logical storage usage reporting.
- File/folder-oriented storage aggregation consumed by clients.

## Storage quota and reconciliation

- Per-user optional storage quotas.
- Used-byte accounting.
- Reserved-byte accounting for in-progress operations.
- Administrator storage overview.
- Logical vs cached usage comparison.
- Unique physical chunk counts/bytes.
- Ready chunk counts.
- Orphan-candidate chunk visibility.
- Quota mismatch detection.
- Administrator quota reconciliation/repair.

## Background jobs and garbage collection

- Configurable worker pool size.
- Persistent PostgreSQL-backed job repository.
- File metadata jobs.
- File thumbnail jobs.
- Retry/worker processing infrastructure.
- Upload expiry worker.
- Orphan chunk garbage collection.
- Direct-object garbage collection.
- Graceful worker shutdown through application context cancellation.

## Operations and diagnostics

- Prometheus-compatible metrics endpoint for administrators.
- Audit-log API.
- Background-jobs diagnostics API.
- Upload diagnostics API.
- Storage diagnostics API.
- Discord bot runtime diagnostics and controls.
- Structured application logs.
- Observability metrics package.
- Trace/observability infrastructure.
- Readiness diagnostics for PostgreSQL and Discord storage.

## Desktop support APIs

The backend exposes specialized endpoints so Desktop can avoid routing every transfer through browser-style file downloads.

- Direct-download manifest for a file.
- Direct-download folder-tree manifest.
- Resolve a window of short-lived Discord CDN chunk URLs for Desktop downloads.
- Normal authorization remains enforced before direct chunk URLs are issued.
- Activity endpoint for recording completed Desktop sync runs.

---

# Web

The Web client is the complete browser interface built with Next.js App Router.

## Public site

- Public landing page.
- Public feature comparison page.
- Desktop release/download discovery.
- Public navigation/header/footer.
- Public share route at `/s/:publicId`.
- Public file share viewer.
- Public folder browser.
- Public collection/item browser.
- Public file preview dialog.
- Public downloads.
- Password unlock UI for protected shares.
- Public-share not-found handling.

## Authentication and setup

- First-server setup page.
- Login form.
- MFA verification during login.
- Forced password-change page.
- Authenticated session loading on the server.
- Logout.
- Route protection for workspace routes.
- Workspace access-denied handling.

## Workspace shell

- Username-scoped workspace routes.
- Application sidebar.
- Application header.
- User menu.
- Workspace switcher.
- Command palette.
- Compact breadcrumbs.
- Route focus management.
- Network status indicator.
- Theme mode toggle.
- Current-user context.
- Workspace context and access validation.

## File browser

- Workspace root browser.
- Folder routes.
- Grid layout.
- List/table layout.
- File/folder visual types.
- Breadcrumbs.
- Pagination/infinite trigger behavior.
- Sorting and browser controls.
- Multi-selection.
- Selection toolbar.
- Context menus.
- Create folder dialog.
- Rename node dialog.
- Move nodes dialog.
- Trash nodes dialog.
- Favorite actions.
- Folder actions menu.
- Shared-state indicators through server models.

## File details and preview

- File detail page.
- Inline preview where supported.
- Preview carousel.
- Thumbnail loading queue.
- Thumbnail preload behavior.
- Preview capability detection.
- Media/content routes backed by server Range support.
- File version history.
- Version download/restore actions represented in the shared UI.

## Browser uploads

- Upload drop target.
- Multiple file uploads.
- Folder upload discovery/tree handling.
- Upload task state store.
- Upload manager dock.
- Dedicated uploads page.
- Chunk planning.
- Per-upload part requests.
- Resumable upload state through backend sessions.
- Retry/cancel behavior represented by the upload engine/store.
- Adaptive client concurrency gate.
- Separate media chunk planning.
- Thumbnail planning/generation support in the upload client.
- Upload progress and status table.

## Search

- Dedicated search route.
- Search input.
- Search filters.
- Search result table.
- Shared search-option helpers.
- Permission-aware backend results.
- Pagination/sorting options supported by the client model.

## Favorites

- Dedicated favorites route.
- Shared favorites view.
- Favorite/unfavorite actions integrated into file browsing.

## Collections

- Collection list route.
- Create collection dialog.
- Collection detail route.
- Rename/edit collection dialog.
- Add file to collection dialog.
- Collection item table.
- Collection file detail route.
- Collection access controls through the general access UI/API.

## Direct sharing and ACL

- Access dialog.
- User lookup/picker for grants.
- Access-grant form.
- Current grants table.
- Folder access management.
- Collection access management.
- Dedicated `shared` route for resources shared with the user.
- Filter toolbar for shared-resource views.

## Public-share management

- Create/manage public share dialog.
- View active public-share settings.
- Configure share access controls supported by the backend.
- Password-protected share configuration.
- Revoke public shares.
- Public-share viewer lives in the Web app even when a share was created from Desktop.

## Trash

- Dedicated Trash route.
- Trash listing.
- Restore actions.
- Permanent delete actions.
- Empty Trash workflow exposed by the backend/shared view.

## Recent activity

- Dedicated activity route.
- Recent activity view using the backend activity feed.

## Storage analyzer

- Dedicated storage route.
- Workspace storage analyzer UI.
- Storage usage visualization based on backend analyzer data.

## Profile and common settings

- Settings overview.
- Profile settings.
- Avatar upload/change UI.
- Identity/profile card.
- Common settings page.
- Theme settings.
- Sidebar settings.
- File-browser settings.
- File-preview settings.
- Pagination settings.
- Date/time and timezone settings.
- Toolbar preview/preferences.
- Shared user-config context so persisted settings update the app consistently.

## Security settings

- Change password UI.
- MFA status/settings.
- TOTP enrollment UI.
- MFA verification action UI.
- Recovery-code display/regeneration workflow.
- Account/session operations supported by the shared API models.

## Administration

### Users

- Administrator dashboard.
- User list/table.
- User lookup utilities.
- Create user dialog.
- Edit user dialog.
- Reset user password dialog.
- Enable/disable user actions.
- User quota dialog.
- Per-user status and storage information.
- Storage quota reconciliation dialog.

### Discord bot runtime

- Bot runtime overview.
- Bot runtime table.
- Runtime summary/capacity view.
- Real-time bot runtime events.
- Probe actions.
- Drain action.
- Disable action.
- Enable action.

### Diagnostics

- Diagnostics route.
- Audit diagnostics.
- Job diagnostics.
- Upload diagnostics.
- Storage/operations diagnostics.
- Diagnostics filtering.

## API and runtime behavior

- Same-origin `/api/backend/*` proxy to the configured backend.
- Separate server-side backend URL and public runtime URL.
- Runtime configuration route for standalone/container deployments.
- Typed API models through `@discloud/api`.
- Server-side session helpers.
- Server-side workspace resolution.
- API error normalization.

## Web UX/platform features

- Next.js App Router server/client rendering split.
- Route-level loading/error/not-found boundaries.
- Responsive shared UI.
- Theme support through shared settings and `next-themes`.
- Toast notifications through Sonner/shared UI.
- Keyboard/command-palette workflows.
- React/Vitest tests for navigation, uploads, search, shares, runtime config and release helpers.

## Web deployment

- Multi-stage Docker build.
- Next.js standalone output.
- Multi-platform release images for Linux `amd64` and `arm64`.
- Standalone Node.js release archives for Linux `amd64` and `arm64`.
- SHA-256 checksum file for standalone archives.
- GHCR channel tags for stable/RC/beta/alpha and exact release tags.

---

# Desktop

The Desktop client is a React/Vite application hosted in Tauri 2 with a Rust native runtime.

## Server connection and sessions

- Connect to an arbitrary self-hosted DisCloud server.
- Persist selected server URL/session state.
- Change server from the client.
- Detect whether remote setup is required.
- Complete first-server setup.
- Login.
- MFA verification.
- Forced password change.
- Authenticated API transport through the Rust/native bridge.
- Disconnect server/session state.
- Route guards for disconnected, setup, unauthenticated and forced-password-change states.

## Workspace routes

Currently wired routes include:

- workspace files/root
- folders
- file details
- search
- favorites
- collections
- collection details
- collection file details
- shared resources
- recent activity
- storage analyzer
- Trash
- uploads
- downloads
- sync
- common settings
- Desktop settings
- profile settings
- security settings

## Files and folders

- Hierarchical file/folder browser.
- Create folder.
- Rename nodes.
- Move nodes.
- Trash nodes.
- Multi-selection toolbar.
- Node actions/context menu.
- File detail view.
- File preview through authenticated custom protocols/server media.
- File version history.
- Shared file-browser/product UI where behavior matches Web.

## Search, favorites and collections

- Search route and result table.
- Favorites route.
- Collection list.
- Collection detail.
- Collection file detail.
- Collection actions.
- Same backend permission model as Web.

## Sharing

- Direct-access dialog for authenticated resource sharing.
- Shared-resources route.
- Public-share creation/management dialog.
- Public share URLs target the Web public viewer.

## Native upload manager

- Native upload engine in Rust.
- Add individual file paths.
- Add directory paths recursively.
- Drag-and-drop path authorization.
- Upload task planning.
- Native file reading.
- Backend upload-session creation/part/finalize flow.
- Upload snapshot exposed to React.
- Retry upload task.
- Cancel upload task.
- Remove upload task.
- Dedicated uploads page.
- Transfer dock integration.
- Upload state tests.

## Native download manager

- Native download engine in Rust.
- Download a single file.
- Download a folder tree.
- Use backend direct-download manifests.
- Resolve windows of short-lived Discord CDN chunk URLs.
- Stream chunks directly to local files under backend authorization.
- Download snapshot exposed to React.
- Start queued download.
- Retry download task.
- Cancel download task.
- Remove download task.
- Reveal completed download in the operating-system file manager.
- Dedicated downloads page.
- Transfer dock integration.
- Download state tests.

## Local folder sync

- Configure local/remote sync pairs.
- Native folder picker/grants.
- Validate sync-pair configuration.
- Persistent sync preferences.
- Background sync scheduler started with the app.
- Manual run of a sync pair.
- Local filesystem scanning.
- Remote/local baseline tracking.
- Reconciliation engine.
- Upload/download transfer during sync.
- Conflict detection.
- Conflict listing.
- Conflict resolution.
- Conflict center UI.
- Open local path from a sync conflict/item.
- Clear/reset sync-pair state.
- Revoke local folder authorization.
- Sync folder badges/status UI.
- Record completed sync activity on the backend.
- Unit tests for pair validation/provider behavior.

## Native thumbnails and local media

- Native thumbnail state/service.
- `discloud-thumbnail:` custom URI protocol.
- `discloud:` authenticated file/media protocol.
- Local/OS thumbnail generation path.
- FFmpeg sidecar fallback for media thumbnail generation.
- Platform-targeted FFmpeg release binaries.
- Thumbnail responses stay inside the Tauri custom-protocol boundary.

## Native filesystem/security

- Tauri filesystem plugin.
- Tauri dialog plugin.
- Explicit path-security module.
- Files/directories dropped into the WebView are granted to the Tauri FS scope.
- Sync roots use explicit folder authorization/grants.
- Custom URI protocols instead of arbitrary direct WebView file access.
- CSP restricts WebView network/media/image sources to expected local/custom protocols.

## Desktop runtime integration

- Single-instance plugin; a second launch brings the main window forward.
- System tray runtime.
- Close-to-tray preference.
- Native notification plugin.
- Autostart plugin with hidden-start argument support.
- Persistent Tauri store.
- Native shell integration.
- Window runtime management.
- Native context-menu provider on the React side.

## Desktop diagnostics

- Read Desktop diagnostics.
- Native log collection.
- Export Desktop logs.
- Clear Desktop logs.
- Open Desktop log directory.
- Desktop diagnostics settings UI.

## Desktop settings

- Shared common workspace settings from the backend.
- Desktop-only preference storage.
- Close-to-tray controls.
- Transfer/native preferences represented by the native settings modules.
- Sync preferences.
- Updater preferences/channel selection.
- Profile settings.
- Security settings.
- Save recovery codes through a native command.

## Signed updater

- Tauri updater plugin.
- Check for updates from Rust.
- Install an available update.
- Signed updater artifacts.
- Stable channel using the latest stable `latest.json`.
- Mutable RC channel manifest.
- Mutable beta channel manifest.
- Mutable alpha channel manifest.
- Channel preference stored by the Desktop client.
- Windows prereleases use NSIS bundles to avoid MSI prerelease-version restrictions.
- macOS Intel and Apple Silicon release targets.
- Linux x64 release target.
- Windows x64 release target.

## Desktop administration status

The repository contains substantial Desktop administration implementations:

- user administration UI
- user create/edit/reset/enable/disable/quota actions
- storage overview and quota reconciliation
- Discord bot runtime UI/actions
- diagnostics UI

However, the current `desktop/src/router.tsx` still maps `/admin`, `/admin/bots` and `/admin/diagnostics` to placeholder components. These features are therefore **implemented as modules but not yet fully exposed through the current Desktop route tree**.

---

# Shared client infrastructure

Although this inventory is organized by Backend/Web/Desktop, the two clients intentionally share significant implementation through workspace packages.

## `@discloud/api`

- Generated OpenAPI TypeScript definitions.
- Shared API models.
- Shared transport interfaces.
- Shared error/contract types.

## `@discloud/app-ui`

- Authentication forms.
- File-browser product UI.
- File previews/version history.
- Search UI.
- Favorites/collections/shared/trash views.
- Shared settings UI.
- App-shell/navigation building blocks.
- Storage analyzer UI.

## `@discloud/shared`

- File-browser logic.
- File-browser commands.
- File-preview capability helpers.
- Formatting helpers.
- Workspace navigation helpers.
- Node-name helpers.
- Search helpers.
- Theme-transition helpers.

## `@discloud/ui`

- Shared React component primitives.
- Shared Tailwind/global styles.
- Forms, dialogs, menus, tables, navigation, feedback and layout primitives.
- Shared hooks and UI utilities.

---

# Related documentation

- [Repository README](README.md)
- [Web README](web/README.md)
- [Desktop README](desktop/README.md)
- [`@discloud/api`](packages/api/README.md)
- [`@discloud/app-ui`](packages/app-ui/README.md)
- [`@discloud/shared`](packages/shared/README.md)
- [`@discloud/ui`](packages/ui/README.md)
- [OpenAPI contract](docs/openapi.json)
- [Security](docs/SECURITY.md)
- [Operations](docs/OPERATIONS.md)
