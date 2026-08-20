# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM golang:1.26.5-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./

RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY cmd ./cmd
COPY internal ./internal
COPY migrations ./migrations

ARG TARGETOS=linux
ARG TARGETARCH=amd64

RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" \
    go build -trimpath -ldflags="-s -w" -o /out/discloud ./cmd/discloud


FROM alpine:3.24.1 AS runtime

ARG UID=1000
ARG GID=1000

RUN apk add --no-cache \
    ca-certificates \
    ffmpeg \
    && addgroup -g "$GID" discloud \
    && adduser -D -H -u "$UID" -G discloud discloud \
    && mkdir -p /tmp \
    && chmod 1777 /tmp

ENV TMPDIR=/tmp

USER discloud

EXPOSE 8080


# GoReleaser target.
# dockers_v2 provides $TARGETPLATFORM/discloud in its temporary build context.
FROM runtime AS release

ARG TARGETPLATFORM

COPY $TARGETPLATFORM/discloud /discloud

ENTRYPOINT ["/discloud"]


# Default target for docker build / docker compose build.
FROM runtime AS local

COPY --from=build /out/discloud /discloud

ENTRYPOINT ["/discloud"]