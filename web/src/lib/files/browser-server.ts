import "server-only"

import type { Breadcrumbs, FolderChildrenQuery, Node, NodePage } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"
import type { BrowserOptions } from "@/lib/files/browser"

export type FileBrowserData = {
  folder: Node
  breadcrumbs: readonly Node[]
  page: NodePage
}

export async function loadFileBrowser(
  folderId: string,
  options: BrowserOptions,
): Promise<FileBrowserData> {
  const query = {
    limit: 50,
    sort: options.sort,
    order: options.order,
  } satisfies FolderChildrenQuery

  const [breadcrumbs, page] = await Promise.all([
    apiServerAuthJSON<Breadcrumbs>(
      `/api/v1/folders/${encodeURIComponent(folderId)}/breadcrumbs`,
    ),
    apiServerAuthJSON<NodePage>(
      `/api/v1/folders/${encodeURIComponent(folderId)}/children`,
      { query },
    ),
  ])

  const folder = breadcrumbs.breadcrumbs[
    breadcrumbs.breadcrumbs.length - 1
  ]

  if (!folder) {
    throw new Error("folder breadcrumbs are empty")
  }

  return {
    folder,
    breadcrumbs: breadcrumbs.breadcrumbs,
    page,
  }
}