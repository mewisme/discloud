<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# DisCloud web conventions

## Tooling

- Use pnpm only.
- Keep imports contiguous.
- Keep code compact and readable; avoid unnecessary line breaks and empty lines.
- Run `pnpm lint`, `pnpm typecheck`, and `pnpm build` before considering a web phase complete.

## Next.js

- Use App Router.
- Server Components are the default.
- Add `"use client"` only for browser APIs, event handlers, hooks, or interactive state.
- Read the installed Next.js documentation under `node_modules/next/dist/docs/` before using framework APIs.
- Use route groups:
  - `(public)` for unauthenticated public pages and public shares.
  - `(auth)` for setup, login, and MFA flows.
  - `(app)` for authenticated application routes.
  - admin routes live under `(app)/admin`.
- Keep navigation/filter state in the URL when it should survive refresh or deep linking.
- Keep transient component state local.

## UI

Before implementing UI, prefer in this order:

1. Existing `src/components/ui` primitive.
2. Official shadcn/ui component.
3. Configured or suitable shadcn registry component.
4. Mature dedicated library.
5. Browser/React/Next.js native API.
6. Minimal custom code.

Use `pnpm dlx shadcn@latest add <component>` when adding official shadcn components.

Do not add a registry to `components.json` until a feature actually needs it.

Keep registry primitives in `src/components/ui`. Compose application or feature-specific components outside `ui`.

Do not recreate dialogs, drawers, dropdowns, forms, tables, command palettes, toasts, carousels, OTP inputs, charts, resizable panels, or other primitives already covered by shadcn or installed libraries.

## Data

- The backend OpenAPI contract is the source of truth.
- Generate API types with `pnpm api:types`.
- Commit `src/lib/api/generated.ts` but never edit it manually.
- Use types from `src/lib/api/models.ts` or derive them from generated operations.
- Run `pnpm api:types:check` when backend OpenAPI changes.
- Do not invent client-only API fields or domain semantics.
- Backend session cookies remain the authentication source of truth.
- Never store authentication tokens in localStorage or sessionStorage.
- Do not scatter raw backend `fetch` calls across components.

## State

Prefer:

1. URL state for navigation, filters, sorting, pagination, and shareable state.
2. Local React state for transient UI.
3. Context/provider for genuinely app-wide ephemeral state.
4. A state library only when the previous options are insufficient.

Do not add Redux, Zustand, TanStack Query, or similar libraries preemptively.

The upload manager may become an app-level state exception because uploads must survive route navigation.

## Components

- Keep components focused.
- Avoid wrapper components that add no behavior or domain meaning.
- Prefer composition over large configurable components.
- Keep feature-specific code close to its feature.
- Extract shared code only after real reuse appears.