# syntax=docker/dockerfile:1

FROM node:24-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

FROM base AS deps

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/app-ui/package.json ./packages/app-ui/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @discloud/web...

FROM base AS build

WORKDIR /app

COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY --from=deps /app/packages/app-ui/node_modules ./packages/app-ui/node_modules
COPY --from=deps /app/packages/ui/node_modules ./packages/ui/node_modules

COPY packages ./packages
COPY web ./web

ENV NEXT_TELEMETRY_DISABLED=1

RUN mkdir -p web/public \
    && pnpm --filter @discloud/web build

FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build --chown=node:node /app/web/.next/standalone ./
COPY --from=build --chown=node:node /app/web/.next/static ./.next/static
COPY --from=build --chown=node:node /app/web/public ./public

USER node

EXPOSE 3000

CMD ["node", "server.js"]