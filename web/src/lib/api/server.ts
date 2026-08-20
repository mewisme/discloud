import "server-only"

import { headers as requestHeaders } from "next/headers"

import { apiError } from "@/lib/api/error"
import { apiBackendPath } from "@/lib/api/path"
import type { APIRequestInit, Query } from "@/lib/api/types"

export async function apiServerJSON<T>(path: string, options: APIRequestInit = {}): Promise<T> {
  const { query, timeoutMs = 30_000, signal, ...init } = options
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json, application/problem+json")

  const response = await fetch(apiServerURL(path, query), {
    ...init,
    headers,
    cache: "no-store",
    signal: signal ?? (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined),
  })

  if (!response.ok) throw await apiError(response)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function apiServerAuthJSON<T>(path: string, options: APIRequestInit = {}): Promise<T> {
  const incoming = await requestHeaders()
  const headers = new Headers(options.headers)
  const cookie = incoming.get("cookie")
  if (cookie) headers.set("Cookie", cookie)
  return apiServerJSON<T>(path, { ...options, headers })
}

function apiServerURL(path: string, query?: Query) {
  const raw = process.env.DISCLOUD_API_URL?.trim()
  if (!raw) throw new Error("DISCLOUD_API_URL is not configured")

  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid backend protocol")

  url.pathname = `${url.pathname.replace(/\/+$/, "")}${apiBackendPath(path)}`

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value == null) continue
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) search.append(key, String(item))
  }

  url.search = search.toString()
  url.hash = ""
  return url
}