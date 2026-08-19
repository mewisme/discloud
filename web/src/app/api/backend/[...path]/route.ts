import "server-only"

type RouteContext = {
  params: Promise<{ path: string[] }>
}

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"])
const strippedHeaders = [
  "host",
  "origin",
  "referer",
  "content-length",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
]

async function proxy(request: Request, { params }: RouteContext) {
  if (!safeMethods.has(request.method) && !validRequestOrigin(request)) {
    return problem(403, "Forbidden", "cross-origin request blocked")
  }

  const { path } = await params
  let target: URL

  try {
    target = backendTarget(path, request.url)
  } catch {
    return problem(503, "Service Unavailable", "backend API is not configured")
  }

  const upstream = new Request(target, request)
  for (const header of strippedHeaders) upstream.headers.delete(header)

  try {
    return await fetch(upstream, { cache: "no-store" })
  } catch {
    return problem(502, "Bad Gateway", "backend API is unavailable")
  }
}

function backendTarget(path: string[], requestURL: string) {
  const raw = process.env.DISCLOUD_API_URL?.trim()
  if (!raw) throw new Error("DISCLOUD_API_URL is not configured")

  const target = new URL(raw)
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("invalid backend protocol")

  const basePath = target.pathname.replace(/\/+$/, "")
  target.pathname = `${basePath}/${path.map(encodeURIComponent).join("/")}`
  target.search = new URL(requestURL).search
  target.hash = ""
  return target
}

function validRequestOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site")?.trim().toLowerCase() ?? ""

  switch (site) {
    case "cross-site":
    case "same-site":
      return false
    case "":
    case "same-origin":
    case "none":
      break
    default:
      return false
  }

  const expected = new URL(request.url).origin
  const origin = request.headers.get("origin")
  if (origin) return originOf(origin) === expected

  const referer = request.headers.get("referer")
  return !referer || originOf(referer) === expected
}

function originOf(value: string) {
  try {
    return new URL(value).origin
  } catch {
    return ""
  }
}

function problem(status: number, title: string, detail: string) {
  return new Response(JSON.stringify({ type: "about:blank", title, status, detail }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  })
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
  proxy as OPTIONS,
}