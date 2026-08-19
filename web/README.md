# DisCloud Web

Next.js web client for DisCloud.

The client is currently scaffolded and will consume the versioned DisCloud
HTTP API.

## Development

Install dependencies:

```bash
pnpm install
```

Start the development server:

```bash
pnpm dev
```

Open:

```text
http://localhost:3000
```

## Checks

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

Backend API contracts are documented in:

```text
../docs/openapi.json
```
