import "server-only"

import { headers as requestHeaders } from "next/headers"

import { apiError } from "@/lib/api/error"
import { apiBackendPath } from "@/lib/api/path"
import type { APIRequestInit, Query } from "@/lib/api/types"

export async function apiServerJSON<T>(
  path: string,
  options: APIRequestInit = {},
): Promise<T> {
  const {
    query,
    timeoutMs = 30_000,
    signal,
    ...init
  } = options

  const headers = new Headers(init.headers)
  headers.set(
    "Accept",
    "application/json, application/problem+json",
  )

  const url = apiServerURL(path, query)
  const response = await serverFetch(
    url,
    {
      ...init,
      headers,
      cache: "no-store",
    },
    {
      path,
      timeoutMs,
      signal,
    },
  )

  if (!response.ok) {
    throw await apiError(response)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export async function apiServerAuthJSON<T>(
  path: string,
  options: APIRequestInit = {},
): Promise<T> {
  const incoming = await requestHeaders()
  const headers = new Headers(options.headers)
  const cookie = incoming.get("cookie")

  if (cookie) {
    headers.set("Cookie", cookie)
  }

  return apiServerJSON<T>(
    path,
    {
      ...options,
      headers,
    },
  )
}

async function serverFetch(
  url: URL,
  init: RequestInit,
  {
    path,
    timeoutMs,
    signal,
  }: {
    path: string
    timeoutMs: number
    signal?: AbortSignal | null
  },
) {
  if (signal || timeoutMs <= 0) {
    try {
      return await fetch(
        url,
        {
          ...init,
          signal: signal ?? undefined,
        },
      )
    } catch (error) {
      throw normalizeServerFetchError(
        error,
        path,
      )
    }
  }

  const controller = new AbortController()

  const timeout = setTimeout(
    () => {
      controller.abort(
        new Error(
          `Backend API request timed out after ${timeoutMs}ms: ${path}`,
        ),
      )
    },
    timeoutMs,
  )

  try {
    return await fetch(
      url,
      {
        ...init,
        signal: controller.signal,
      },
    )
  } catch (error) {
    if (
      controller.signal.aborted &&
      controller.signal.reason instanceof Error
    ) {
      throw controller.signal.reason
    }

    throw normalizeServerFetchError(
      error,
      path,
    )
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeServerFetchError(
  error: unknown,
  path: string,
) {
  if (error instanceof Error) {
    if (error instanceof DOMException) {
      return new Error(
        `Backend API request failed for ${path}: ${error.name}: ${error.message}`,
      )
    }

    return error
  }

  return new Error(
    `Backend API request failed for ${path}: ${String(error)}`,
  )
}

function apiServerURL(
  path: string,
  query?: Query,
) {
  const raw =
    process.env.DISCLOUD_API_URL?.trim()

  if (!raw) {
    throw new Error(
      "DISCLOUD_API_URL is not configured",
    )
  }

  const url = new URL(raw)

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    throw new Error(
      "invalid backend protocol",
    )
  }

  url.pathname =
    `${url.pathname.replace(/\/+$/, "")}${apiBackendPath(path)}`

  const search = new URLSearchParams()

  for (
    const [key, value]
    of Object.entries(query ?? {})
  ) {
    if (value == null) {
      continue
    }

    const values =
      Array.isArray(value)
        ? value
        : [value]

    for (const item of values) {
      search.append(
        key,
        String(item),
      )
    }
  }

  url.search = search.toString()
  url.hash = ""

  return url
}