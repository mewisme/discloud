# @discloud/ui

Shared React design-system primitives for DisCloud Web, Desktop and `@discloud/app-ui`.

The package contains reusable low-level components, hooks, utility helpers and global Tailwind CSS styles. Product-specific workflows belong in `@discloud/app-ui` instead.

## Usage

Import components directly through subpath exports:

```ts
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent } from "@discloud/ui/components/dialog"
import { useIsMobile } from "@discloud/ui/hooks/use-mobile"
```

Import the shared stylesheet from the client entry point:

```ts
import "@discloud/ui/globals.css"
```

## Component groups

The package includes primitives for:

- buttons, button groups and toggles
- forms, inputs, OTP, selects, comboboxes and fields
- dialogs, alert dialogs, drawers, sheets and popovers
- dropdowns, context menus, menubars and navigation menus
- cards, alerts, badges, avatars and empty states
- tables, pagination and scroll areas
- tabs, accordions, collapsibles and resizable panels
- tooltips, hover cards and command palettes
- calendars, carousels, charts and progress indicators
- breadcrumbs, sidebars and navigation helpers
- attachment/message presentation components
- notifications through Sonner
- loading states, skeletons and spinners

See `src/components/` for the complete component list.

## Package layout

```text
src/components/       Reusable React primitives
src/hooks/            Shared UI hooks
src/lib/              UI utility helpers
src/styles/globals.css
components.json       shadcn component configuration
```

## Dependencies

The package builds on the workspace UI stack, including Base UI/Radix-compatible primitives, shadcn, Tailwind CSS, class-variance-authority, Lucide, Motion, Recharts and Sonner.

React, React DOM and Tailwind CSS are peer dependencies so each consuming application owns its runtime and CSS pipeline.

## Development

Install dependencies from the repository root:

```bash
pnpm install
```

Type-check:

```bash
pnpm ui:typecheck
```

or from this directory:

```bash
pnpm typecheck
```

The package is consumed as source and does not produce a separate build artifact.

## Adding a component

When adding or updating a primitive:

1. Keep it product-agnostic.
2. Put the implementation in `src/components/`, `src/hooks/` or `src/lib/`.
3. Use existing shared utility helpers and tokens instead of duplicating styles.
4. Import it through the package subpath from consumers.
5. Run `pnpm ui:typecheck` and type-check affected client packages.

If a component starts to contain DisCloud-specific files, users, collections, storage or authentication behavior, it likely belongs in [`@discloud/app-ui`](../app-ui/README.md).

## Consumers

- [DisCloud Web](../../web/README.md)
- [DisCloud Desktop](../../desktop/README.md)
- [`@discloud/app-ui`](../app-ui/README.md)

## Related documentation

- [Repository README](../../README.md)
- [Complete feature inventory](../../FEATURES.md)
- [`@discloud/app-ui`](../app-ui/README.md)
