import type { Query } from "@/lib/api/types"

const API_PREFIX = "/api/backend"
const API_VERSION_PREFIX = "/api/v1"
const API_VERSION_SEGMENTS = ["api", "v1"] as const

export function apiURL(path: string, query?: Query) {
  const pathname = apiProxyPath(path)
  const search = queryString(query)

  return `${API_PREFIX}${pathname}${search ? `?${search}` : ""}`
}

export function apiDirectURL(path: string, query?: Query) {
  const raw = process.env.NEXT_PUBLIC_DISCLOUD_API_URL?.trim()

  if (!raw) return apiURL(path, query)

  const url = new URL(raw)

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_DISCLOUD_API_URL must use HTTP or HTTPS")
  }

  url.pathname = `${url.pathname.replace(/\/+$/, "")}${apiBackendPath(path)}`
  url.search = queryString(query)
  url.hash = ""

  return url.toString()
}

export function apiBackendPath(path: string) {
  const pathname = normalizePath(path)

  if (
    pathname === API_VERSION_PREFIX ||
    pathname.startsWith(`${API_VERSION_PREFIX}/`)
  ) {
    return pathname
  }

  return pathname === "/"
    ? API_VERSION_PREFIX
    : `${API_VERSION_PREFIX}${pathname}`
}

export function apiProxyPath(path: string) {
  const pathname = normalizePath(path)

  if (pathname === API_VERSION_PREFIX) return "/"

  if (pathname.startsWith(`${API_VERSION_PREFIX}/`)) {
    return pathname.slice(API_VERSION_PREFIX.length)
  }

  return pathname
}

export function apiBackendSegments(path: readonly string[]) {
  if (
    path[0] === API_VERSION_SEGMENTS[0] &&
    path[1] === API_VERSION_SEGMENTS[1]
  ) {
    return [...path]
  }

  return [...API_VERSION_SEGMENTS, ...path]
}

function queryString(query?: Query) {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value == null) continue

    const values = Array.isArray(value)
      ? value
      : [value]

    for (const item of values) {
      search.append(key, String(item))
    }
  }

  return search.toString()
}

function normalizePath(path: string) {
  return `/${path.replace(/^\/+/, "")}`
}