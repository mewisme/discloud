# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM alpine:3.24.1 AS certs

RUN apk add --no-cache ca-certificates \
    && mkdir -p /tmp \
    && chmod 1777 /tmp

# GoReleaser target.
# dockers_v2 provides $TARGETPLATFORM/discloud in its temporary build context.
FROM scratch AS release

ARG TARGETPLATFORM
ARG UID=1000
ARG GID=1000

COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=certs --chmod=1777 /tmp /tmp
COPY $TARGETPLATFORM/discloud /discloud

ENV TMPDIR=/tmp

USER ${UID}:${GID}

EXPOSE 8080

ENTRYPOINT ["/discloud"]

# Normal source build target.
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
    go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/discloud \
    ./cmd/discloud

# Default target for docker build / docker compose build.
FROM scratch AS local

ARG UID=1000
ARG GID=1000

COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=certs --chmod=1777 /tmp /tmp
COPY --from=build /out/discloud /discloud

ENV TMPDIR=/tmp

USER ${UID}:${GID}

EXPOSE 8080

ENTRYPOINT ["/discloud"]