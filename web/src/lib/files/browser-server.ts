import "server-only"
import { apiServerAuthJSON } from "@/lib/api/server"
import type { Breadcrumbs, CurrentUserRoot, FolderChildrenQuery, Node, NodePage } from "@/lib/api/models"
import type { BrowserOptions } from "@/lib/files/browser"

export type FileBrowserData = {
  folder: Node
  breadcrumbs: readonly Node[]
  page: NodePage
}

export async function loadFileBrowser(folderId: string | undefined, options: BrowserOptions): Promise<FileBrowserData> {
  const query = { limit: 50, sort: options.sort, order: options.order } satisfies FolderChildrenQuery

  if (!folderId) {
    const folder = await apiServerAuthJSON<CurrentUserRoot>("/api/v1/me/root")
    const page = await apiServerAuthJSON<NodePage>(`/api/v1/folders/${folder.id}/children`, { query })
    return { folder, breadcrumbs: [folder], page }
  }

  const [breadcrumbs, page] = await Promise.all([
    apiServerAuthJSON<Breadcrumbs>(`/api/v1/folders/${folderId}/breadcrumbs`),
    apiServerAuthJSON<NodePage>(`/api/v1/folders/${folderId}/children`, { query }),
  ])

  const folder = breadcrumbs.breadcrumbs[breadcrumbs.breadcrumbs.length - 1]
  if (!folder) throw new Error("folder breadcrumbs are empty")
  return { folder, breadcrumbs: breadcrumbs.breadcrumbs, page }
}