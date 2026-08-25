# @discloud/app-ui

Shared product-level React UI for DisCloud Web and Desktop.

`@discloud/ui` provides low-level primitives; `@discloud/app-ui` combines those primitives with DisCloud models and workflows into reusable application surfaces such as file browsers, authentication forms, settings and storage views.

## What belongs here?

Use this package when a component represents a DisCloud product concept and can be shared by both clients.

Examples:

- authentication forms
- file-browser views
- file previews and version history
- collections and favorites
- search filters and result tables
- settings rows and preference editors
- shared-resource views
- public-share settings
- storage analyzer UI
- application shell/navigation building blocks

Client-specific transport, routing and native behavior should stay in `web/` or `desktop/`.

## Feature areas

```text
src/activity/       Recent activity UI
src/admin/          Shared administration headers/surfaces
src/auth/           Login, setup and password forms
src/collections/    Collection views
src/favorites/      Favorites view
src/files/          File-browser core and UI
src/search/         Search filters and results
src/settings/       Shared workspace settings
src/shared/         Shared-resource views and filtering
src/shares/         Public-share settings
src/shell/          App shell and navigation
src/storage/        Storage analyzer
src/trash/          Trash view
```

## Imports

The package uses subpath exports instead of a barrel index.

```ts
import { LoginForm } from "@discloud/app-ui/auth/login-form"
import { FilePreview } from "@discloud/app-ui/files/file-preview"
import { SearchFilters } from "@discloud/app-ui/search/search-filters"
import { AppShell } from "@discloud/app-ui/shell/app-shell"
```

The package also exposes shared file-browser types/helpers and shell navigation helpers through:

```text
@discloud/app-ui/files/file-browser
@discloud/app-ui/shell/navigation
```

## Dependencies

| Package | Role |
| --- | --- |
| `@discloud/api` | Backend models and contracts |
| `@discloud/shared` | Framework-neutral application utilities |
| `@discloud/ui` | Design-system primitives |
| React Hook Form + Zod | Shared forms and validation |

React and React DOM are peer dependencies so Web and Desktop own the runtime.

## Development

Install dependencies from the monorepo root:

```bash
pnpm install
```

Type-check this package:

```bash
pnpm app-ui:typecheck
```

or from this directory:

```bash
pnpm typecheck
```

There is intentionally no standalone app or build command. Source files are consumed directly by the workspace clients.

## Design guidelines

- Keep reusable product UI client-agnostic.
- Receive data/actions through props when Web and Desktop transports differ.
- Do not import Next.js, Tauri or client-specific routing modules here.
- Use `@discloud/ui` instead of duplicating low-level primitives.
- Keep domain logic that does not require React in `@discloud/shared` when possible.
- Export feature modules directly through package subpaths; avoid a large barrel file.

## Consumers

- [DisCloud Web](../../web/README.md)
- [DisCloud Desktop](../../desktop/README.md)

## Related documentation

- [Repository README](../../README.md)
- [Complete feature inventory](../../FEATURES.md)
- [`@discloud/api`](../api/README.md)
- [`@discloud/shared`](../shared/README.md)
- [`@discloud/ui`](../ui/README.md)
