export type BrowserView = "list" | "grid"
export type BrowserSort = "name" | "updated" | "size"
export type BrowserOrder = "asc" | "desc"
export type BrowserOptions = { view: BrowserView; sort: BrowserSort; order: BrowserOrder }
export type BrowserSearchParams = Record<string, string | string[] | undefined>

export function parseBrowserOptions(searchParams: BrowserSearchParams): BrowserOptions {
  const view = first(searchParams.view)
  const sort = first(searchParams.sort)
  const order = first(searchParams.order)

  return {
    view: view === "grid" ? "grid" : "list",
    sort: sort === "updated" || sort === "size" ? sort : "name",
    order: order === "desc" ? "desc" : "asc",
  }
}

export function browserURL(pathname: string, options: BrowserOptions) {
  const params = new URLSearchParams()
  if (options.view !== "list") params.set("view", options.view)
  if (options.sort !== "name") params.set("sort", options.sort)
  if (options.order !== "asc") params.set("order", options.order)

  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function folderURL(folderId: string, options: BrowserOptions) {
  return browserURL(`/files/${folderId}`, options)
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}