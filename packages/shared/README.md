# @discloud/shared

Framework-neutral TypeScript utilities shared across DisCloud Web, Desktop and shared product UI.

This package contains application logic that should behave identically in every client but does not require React, Next.js, Tauri or browser-specific APIs.

## Modules

Every file under `src/` is available through the wildcard package export.

| Import | Responsibility |
| --- | --- |
| `@discloud/shared/dom` | Small DOM-oriented helpers safe for shared client use |
| `@discloud/shared/file-browser` | File-browser models and shared behavior |
| `@discloud/shared/file-browser-commands` | Shared file-browser command definitions |
| `@discloud/shared/file-preview` | File-preview capability/helpers |
| `@discloud/shared/format` | Shared formatting utilities |
| `@discloud/shared/navigation` | Workspace paths, route labels and navigation helpers |
| `@discloud/shared/node-name` | File/folder name helpers and validation |
| `@discloud/shared/search` | Search option helpers |
| `@discloud/shared/theme-transition` | Shared theme-transition behavior |

Example:

```ts
import { workspacePath } from "@discloud/shared/navigation"
```

## When to use this package

Put code here when it:

- is shared by Web and Desktop
- does not depend on a specific rendering framework
- represents reusable DisCloud application behavior
- can be tested or reasoned about independently of a client runtime

Keep network models in `@discloud/api`, React product components in `@discloud/app-ui`, and visual primitives in `@discloud/ui`.

## Development

Install dependencies from the repository root:

```bash
pnpm install
```

Type-check:

```bash
pnpm shared:typecheck
```

or from this directory:

```bash
pnpm typecheck
```

The package is source-consumed by workspace clients, so it does not have a separate build output.

## Design guidelines

- Avoid React, Next.js and Tauri dependencies.
- Keep helpers deterministic where possible.
- Prefer small domain modules over generic catch-all utility files.
- Export modules directly with `@discloud/shared/<module>`.
- Keep behavior shared only when Web and Desktop semantics are genuinely the same.

## Consumers

- [DisCloud Web](../../web/README.md)
- [DisCloud Desktop](../../desktop/README.md)
- [`@discloud/app-ui`](../app-ui/README.md)

## Related documentation

- [Repository README](../../README.md)
- [Complete feature inventory](../../FEATURES.md)
