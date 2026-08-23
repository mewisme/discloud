import { workspacePath } from "./navigation"

export type SearchKind = "all" | "file" | "folder"
export type SearchCategory = "all" | "image" | "video" | "audio" | "document" | "text" | "archive" | "application" | "binary" | "other"
export type SearchFlag = "any" | "true" | "false"
export type SearchState = "active" | "trash" | "all"
export type SearchSort = "relevance" | "name" | "created" | "updated" | "size"
export type SearchOrder = "asc" | "desc"
export type SearchQuickFilter = "large" | "images" | "videos" | "recent"

export const SEARCH_LARGE_FILE_MIN_BYTES = 100 * 1024 * 1024
export const SEARCH_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type SearchOptions = {
  q: string
  kind: SearchKind
  category: SearchCategory
  mimeType: string
  favorite: SearchFlag
  shared: SearchFlag
  minSize?: number
  maxSize?: number
  createdFrom: string
  createdTo: string
  updatedFrom: string
  updatedTo: string
  state: SearchState
  sort: SearchSort
  order: SearchOrder
}

export type SearchRequestQuery = {
  q?: string
  kind?: Exclude<SearchKind, "all">
  category?: Exclude<SearchCategory, "all">
  mimeType?: string
  favorite?: boolean
  shared?: boolean
  minSize?: number
  maxSize?: number
  createdFrom?: string
  createdTo?: string
  updatedFrom?: string
  updatedTo?: string
  state?: SearchState
  sort: SearchSort
  order: SearchOrder
}

export function parseSearchOptions(params: Pick<URLSearchParams, "get">): SearchOptions {
  const q = (params.get("q") ?? "").trim().slice(0, 256)
  const kind = parseEnum(params.get("kind"), ["file", "folder"], "all")
  const category = parseEnum(params.get("category"), ["image", "video", "audio", "document", "text", "archive", "application", "binary", "other"], "all")
  const mimeType = (params.get("mimeType") ?? "").trim()
  const favorite = parseEnum(params.get("favorite"), ["true", "false"], "any")
  const shared = parseEnum(params.get("shared"), ["true", "false"], "any")
  const minSize = parseSize(params.get("minSize"))
  const maxSize = parseSize(params.get("maxSize"))
  const createdFrom = parseDateTime(params.get("createdFrom"))
  const createdTo = parseDateTime(params.get("createdTo"))
  const updatedFrom = parseDateTime(params.get("updatedFrom"))
  const updatedTo = parseDateTime(params.get("updatedTo"))
  const state = parseEnum(params.get("state"), ["trash", "all"], "active")
  const fallbackSort = defaultSearchSort(q)
  const rawSort = parseEnum(params.get("sort"), ["relevance", "name", "created", "updated", "size"], fallbackSort)
  const sort = !q && rawSort === "relevance" ? "updated" : rawSort
  const order = parseEnum(params.get("order"), ["asc", "desc"], defaultSearchOrder(sort))

  return normalizeSearchRanges({ q, kind, category, mimeType, favorite, shared, minSize, maxSize, createdFrom, createdTo, updatedFrom, updatedTo, state, sort, order })
}

export function patchSearchOptions(current: SearchOptions, patch: Partial<SearchOptions>): SearchOptions {
  const next = { ...current, ...patch }

  if ("q" in patch) next.q = next.q.trim().slice(0, 256)
  if ("mimeType" in patch) next.mimeType = next.mimeType.trim()
  if ("minSize" in patch) next.minSize = normalizeSize(next.minSize)
  if ("maxSize" in patch) next.maxSize = normalizeSize(next.maxSize)
  if ("createdFrom" in patch) next.createdFrom = normalizeDateTime(next.createdFrom)
  if ("createdTo" in patch) next.createdTo = normalizeDateTime(next.createdTo)
  if ("updatedFrom" in patch) next.updatedFrom = normalizeDateTime(next.updatedFrom)
  if ("updatedTo" in patch) next.updatedTo = normalizeDateTime(next.updatedTo)

  if ("minSize" in patch && next.minSize !== undefined && next.maxSize !== undefined && next.minSize > next.maxSize) next.maxSize = undefined
  if ("maxSize" in patch && next.minSize !== undefined && next.maxSize !== undefined && next.maxSize < next.minSize) next.minSize = undefined
  if ("createdFrom" in patch && isAfter(next.createdFrom, next.createdTo)) next.createdTo = ""
  if ("createdTo" in patch && isAfter(next.createdFrom, next.createdTo)) next.createdFrom = ""
  if ("updatedFrom" in patch && isAfter(next.updatedFrom, next.updatedTo)) next.updatedTo = ""
  if ("updatedTo" in patch && isAfter(next.updatedFrom, next.updatedTo)) next.updatedFrom = ""

  if ("q" in patch && !("sort" in patch) && current.sort === defaultSearchSort(current.q)) next.sort = defaultSearchSort(next.q)
  if (("q" in patch || "sort" in patch) && !("order" in patch) && current.order === defaultSearchOrder(current.sort)) next.order = defaultSearchOrder(next.sort)
  if (!next.q && next.sort === "relevance") next.sort = "updated"

  return next
}

export function searchParamsForOptions(options: SearchOptions) {
  const params = new URLSearchParams()
  const q = options.q.trim()
  const mimeType = options.mimeType.trim()

  if (q) params.set("q", q)
  if (options.kind !== "all") params.set("kind", options.kind)
  if (options.category !== "all") params.set("category", options.category)
  if (mimeType) params.set("mimeType", mimeType)
  if (options.favorite !== "any") params.set("favorite", options.favorite)
  if (options.shared !== "any") params.set("shared", options.shared)
  if (options.minSize !== undefined) params.set("minSize", String(options.minSize))
  if (options.maxSize !== undefined) params.set("maxSize", String(options.maxSize))
  if (options.createdFrom) params.set("createdFrom", options.createdFrom)
  if (options.createdTo) params.set("createdTo", options.createdTo)
  if (options.updatedFrom) params.set("updatedFrom", options.updatedFrom)
  if (options.updatedTo) params.set("updatedTo", options.updatedTo)
  if (options.state !== "active") params.set("state", options.state)
  if (options.sort !== defaultSearchSort(q)) params.set("sort", options.sort)
  if (options.order !== defaultSearchOrder(options.sort)) params.set("order", options.order)

  return params
}

export function searchRequestQuery(options: SearchOptions, canSearchTrash = false): SearchRequestQuery {
  return {
    q: options.q || undefined,
    kind: options.kind === "all" ? undefined : options.kind,
    category: options.category === "all" ? undefined : options.category,
    mimeType: options.mimeType || undefined,
    favorite: options.favorite === "any" ? undefined : options.favorite === "true",
    shared: options.shared === "any" ? undefined : options.shared === "true",
    minSize: options.minSize,
    maxSize: options.maxSize,
    createdFrom: options.createdFrom || undefined,
    createdTo: options.createdTo || undefined,
    updatedFrom: options.updatedFrom || undefined,
    updatedTo: options.updatedTo || undefined,
    state: canSearchTrash && options.state !== "active" ? options.state : undefined,
    sort: options.sort,
    order: options.order,
  }
}

export function searchQuickFilterPatch(filter: SearchQuickFilter, now = new Date()): Partial<SearchOptions> {
  switch (filter) {
    case "large":
      return { kind: "file", minSize: SEARCH_LARGE_FILE_MIN_BYTES, sort: "size", order: "desc" }
    case "images":
      return { kind: "file", category: "image" }
    case "videos":
      return { kind: "file", category: "video" }
    case "recent":
      return { updatedFrom: new Date(now.getTime() - SEARCH_RECENT_WINDOW_MS).toISOString(), updatedTo: "", sort: "updated", order: "desc" }
  }
}

export function searchURL(username: string, options: SearchOptions) {
  const query = searchParamsForOptions(options).toString()
  const path = workspacePath(username, "search")
  return query ? `${path}?${query}` : path
}

export function defaultSearchSort(q: string): SearchSort {
  return q.trim() ? "relevance" : "updated"
}

export function defaultSearchOrder(sort: SearchSort): SearchOrder {
  return sort === "name" ? "asc" : "desc"
}

function normalizeSearchRanges(options: SearchOptions): SearchOptions {
  if (options.minSize !== undefined && options.maxSize !== undefined && options.minSize > options.maxSize) options.maxSize = undefined
  if (isAfter(options.createdFrom, options.createdTo)) options.createdTo = ""
  if (isAfter(options.updatedFrom, options.updatedTo)) options.updatedTo = ""
  return options
}

function parseSize(value: string | null) {
  if (!value) return undefined
  const parsed = Number(value)
  return normalizeSize(parsed)
}

function normalizeSize(value: number | undefined) {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function parseDateTime(value: string | null) {
  return value ? normalizeDateTime(value) : ""
}

function normalizeDateTime(value: string) {
  if (!value) return ""
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? "" : new Date(timestamp).toISOString()
}

function isAfter(from: string, to: string) {
  return !!from && !!to && Date.parse(from) > Date.parse(to)
}

function parseEnum<const T extends string, const F extends string>(value: string | null, values: readonly T[], fallback: F): T | F {
  return value && values.includes(value as T) ? value as T : fallback
}
