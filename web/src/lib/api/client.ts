import "client-only"

import { apiError } from "@/lib/api/error"
import { apiProxyPath } from "@/lib/api/path"
import type { APIJSONInit, APIRequestInit, Query } from "@/lib/api/types"

const API_PREFIX = "/api/backend"

export function apiURL(path: string, query?: Query) {
  const pathname = apiProxyPath(path)
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value == null) continue
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) search.append(key, String(item))
  }

  const encoded = search.toString()
  return `${API_PREFIX}${pathname}${encoded ? `?${encoded}` : ""}`
}

export async function apiRequest(path: string, options: APIRequestInit = {}) {
  const { query, timeoutMs = 30_000, signal, ...init } = options
  const control = requestControl(signal, timeoutMs)

  try {
    const response = await fetch(apiURL(path, query), { ...init, credentials: "include", signal: control.signal })
    if (!response.ok) throw await apiError(response)
    return response
  } finally {
    control.cleanup()
  }
}

export async function apiJSON<T>(path: string, options: APIJSONInit = {}): Promise<T> {
  const { body, headers, ...init } = options
  const nextHeaders = new Headers(headers)

  nextHeaders.set("Accept", "application/json, application/problem+json")
  if (body !== undefined) nextHeaders.set("Content-Type", "application/json")

  const response = await apiRequest(path, {
    ...init,
    headers: nextHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function requestControl(signal: AbortSignal | null | undefined, timeoutMs: number) {
  if (timeoutMs <= 0) return { signal: signal ?? undefined, cleanup: () => { } }

  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  const timeout = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs)

  if (signal?.aborted) abort()
  else signal?.addEventListener("abort", abort, { once: true })

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
    },
  }
}