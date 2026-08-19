import "server-only"
import { apiError } from "@/lib/api/error"

export async function apiServerJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json, application/problem+json")

  const response = await fetch(apiServerURL(path), {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(30_000),
  })

  if (!response.ok) throw await apiError(response)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function apiServerURL(path: string) {
  const raw = process.env.DISCLOUD_API_URL?.trim()
  if (!raw) throw new Error("DISCLOUD_API_URL is not configured")

  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid backend protocol")

  const pathname = path.startsWith("/") ? path : `/${path}`
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${pathname}`
  url.search = ""
  url.hash = ""
  return url
}