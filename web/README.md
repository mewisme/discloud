# DisCloud Web

Next.js client for DisCloud.

## Development

Create the environment file:

```bash
cp .env.example .env.local
````

Install dependencies:

```bash
pnpm install
```

Start the backend, then run:

```bash
pnpm dev
```

Open:

```text
http://localhost:3000
```

Browser API requests use the same-origin `/api/backend/*` proxy. The backend URL is configured server-side through:

```text
DISCLOUD_API_URL
```

## Checks

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

Backend API contract:

```text
../docs/openapi.json
```