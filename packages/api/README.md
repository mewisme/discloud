# @discloud/api

Shared TypeScript API contract for DisCloud Web and Desktop.

This package converts the backend OpenAPI document into strongly typed generated definitions, then adds stable model and transport types used by both clients.

## Source of truth

The canonical API contract is:

```text
docs/openapi.json
```

Generated output:

```text
packages/api/src/generated.ts
```

Do not manually edit `src/generated.ts`. Update the OpenAPI contract and regenerate it instead.

## Exports

| Import | Purpose |
| --- | --- |
| `@discloud/api/generated` | Raw generated OpenAPI TypeScript definitions |
| `@discloud/api/contracts` | Higher-level request/response contract helpers |
| `@discloud/api/errors` | Shared API error types |
| `@discloud/api/models` | Application-facing model aliases and structures |
| `@discloud/api/transport` | Transport interfaces shared by clients |
| `@discloud/api/types` | General API utility types |

Example:

```ts
import type { User } from "@discloud/api/models"
import type { ApiTransport } from "@discloud/api/transport"
```

## Commands

From the repository root:

```bash
pnpm api:types
pnpm api:types:check
pnpm api:typecheck
```

From this package:

```bash
pnpm api:types
pnpm api:types:check
pnpm typecheck
```

| Command | Purpose |
| --- | --- |
| `api:types` | Regenerate `src/generated.ts` from `docs/openapi.json` |
| `api:types:check` | Fail when generated types are stale |
| `typecheck` | Type-check package sources |

## Change workflow

When a backend API changes:

1. Update the backend handler and OpenAPI contract together.
2. Run `pnpm api:types`.
3. Review the generated diff.
4. Update higher-level models/contracts when required.
5. Run `pnpm api:types:check` and `pnpm api:typecheck`.
6. Type-check Web and Desktop consumers.

Useful verification:

```bash
pnpm api:types:check
pnpm api:typecheck
pnpm web:typecheck
pnpm desktop:typecheck
```

## Design rules

- Keep backend endpoint shapes in OpenAPI rather than duplicating them manually.
- Keep this package independent from React and UI code.
- Prefer stable application-facing aliases in `models.ts` when raw generated types are awkward for consumers.
- Transport contracts should describe client behavior without assuming Next.js or Tauri.

## Consumers

- [DisCloud Web](../../web/README.md)
- [DisCloud Desktop](../../desktop/README.md)
- [`@discloud/app-ui`](../app-ui/README.md)

## Related documentation

- [Repository README](../../README.md)
- [OpenAPI contract](../../docs/openapi.json)
- [Complete feature inventory](../../FEATURES.md)
