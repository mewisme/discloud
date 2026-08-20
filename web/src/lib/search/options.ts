export type SearchKind = "all" | "file" | "folder"
export type SearchCategory = "all" | "image" | "video" | "audio" | "document" | "text" | "archive" | "application" | "binary" | "other"
export type SearchFlag = "any" | "true" | "false"
export type SearchSort = "relevance" | "name" | "created" | "updated" | "size"
export type SearchOrder = "asc" | "desc"

export type SearchOptions = {
  q: string
  ownerId: string
  kind: SearchKind
  category: SearchCategory
  favorite: SearchFlag
  shared: SearchFlag
  sort: SearchSort
  order: SearchOrder
}

export function parseSearchOptions(params: Pick<URLSearchParams, "get">): SearchOptions {
  const q = (params.get("q") ?? "").trim().slice(0, 256)
  const ownerId = parseUUID(params.get("ownerId"))
  const kind = parseEnum(params.get("kind"), ["file", "folder"], "all")
  const category = parseEnum(params.get("category"), ["image", "video", "audio", "document", "text", "archive", "application", "binary", "other"], "all")
  const favorite = parseEnum(params.get("favorite"), ["true", "false"], "any")
  const shared = parseEnum(params.get("shared"), ["true", "false"], "any")
  const fallbackSort = defaultSearchSort(q)
  const rawSort = parseEnum(params.get("sort"), ["relevance", "name", "created", "updated", "size"], fallbackSort)
  const sort = !q && rawSort === "relevance" ? "updated" : rawSort
  const order = parseEnum(params.get("order"), ["asc", "desc"], defaultSearchOrder(sort))

  return { q, ownerId, kind, category, favorite, shared, sort, order }
}

export function patchSearchOptions(current: SearchOptions, patch: Partial<SearchOptions>): SearchOptions {
  const next = { ...current, ...patch }

  if ("q" in patch && !("sort" in patch) && current.sort === defaultSearchSort(current.q)) {
    next.sort = defaultSearchSort(next.q)
  }
  if (("q" in patch || "sort" in patch) && !("order" in patch) && current.order === defaultSearchOrder(current.sort)) {
    next.order = defaultSearchOrder(next.sort)
  }

  if (!next.q && next.sort === "relevance") next.sort = "updated"
  return next
}

export function searchURL(options: SearchOptions) {
  const params = new URLSearchParams()
  const q = options.q.trim()

  if (q) params.set("q", q)
  if (options.ownerId) params.set("ownerId", options.ownerId)
  if (options.kind !== "all") params.set("kind", options.kind)
  if (options.category !== "all") params.set("category", options.category)
  if (options.favorite !== "any") params.set("favorite", options.favorite)
  if (options.shared !== "any") params.set("shared", options.shared)
  if (options.sort !== defaultSearchSort(q)) params.set("sort", options.sort)
  if (options.order !== defaultSearchOrder(options.sort)) params.set("order", options.order)

  const query = params.toString()
  return query ? `/search?${query}` : "/search"
}

export function defaultSearchSort(q: string): SearchSort {
  return q.trim() ? "relevance" : "updated"
}

export function defaultSearchOrder(sort: SearchSort): SearchOrder {
  return sort === "name" ? "asc" : "desc"
}

function parseEnum<const T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return value && values.includes(value as T) ? value as T : fallback
}

function parseUUID(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? ""
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized) ? normalized : ""
}