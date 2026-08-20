const API_VERSION_PREFIX = "/api/v1"
const API_VERSION_SEGMENTS = ["api", "v1"] as const

export function apiBackendPath(path: string) {
  const pathname = normalizePath(path)
  if (pathname === API_VERSION_PREFIX || pathname.startsWith(`${API_VERSION_PREFIX}/`)) return pathname
  return pathname === "/" ? API_VERSION_PREFIX : `${API_VERSION_PREFIX}${pathname}`
}

export function apiProxyPath(path: string) {
  const pathname = normalizePath(path)
  if (pathname === API_VERSION_PREFIX) return "/"
  if (pathname.startsWith(`${API_VERSION_PREFIX}/`)) return pathname.slice(API_VERSION_PREFIX.length)
  return pathname
}

export function apiBackendSegments(path: readonly string[]) {
  if (path[0] === API_VERSION_SEGMENTS[0] && path[1] === API_VERSION_SEGMENTS[1]) return [...path]
  return [...API_VERSION_SEGMENTS, ...path]
}

function normalizePath(path: string) {
  return `/${path.replace(/^\/+/, "")}`
}