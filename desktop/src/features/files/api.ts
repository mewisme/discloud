import type { Breadcrumbs, FolderChildrenQuery, Node, NodePage, WorkspaceDetails } from "@discloud/api/models"

import { apiJSON } from "#lib/api/transport"

export type DesktopFileBrowserData = {
  workspace: WorkspaceDetails
  folder: Node
  breadcrumbs: readonly Node[]
  page: NodePage
}

export async function loadDesktopFileBrowser(username: string, folderId?: string): Promise<DesktopFileBrowserData> {
  const workspace = await apiJSON<WorkspaceDetails>(`/api/v1/workspaces/${encodeURIComponent(username)}`)
  const targetFolderId = folderId ?? workspace.root.id
  const [breadcrumbs, page] = await Promise.all([loadBreadcrumbs(targetFolderId), loadFolderChildren(targetFolderId)])
  const folder = breadcrumbs.breadcrumbs.at(-1)

  if (!folder) throw new Error("Folder breadcrumbs are empty.")
  if (breadcrumbs.breadcrumbs[0]?.id !== workspace.root.id) throw new Error("Folder does not belong to this workspace.")

  return { workspace, folder, breadcrumbs: breadcrumbs.breadcrumbs, page }
}

export function loadFolderChildren(folderId: string, cursor?: string) {
  const query = { limit: 50, sort: "name", order: "asc", ...(cursor ? { cursor } : {}) } satisfies FolderChildrenQuery
  return apiJSON<NodePage>(`/api/v1/folders/${encodeURIComponent(folderId)}/children`, { query })
}

function loadBreadcrumbs(folderId: string) {
  return apiJSON<Breadcrumbs>(`/api/v1/folders/${encodeURIComponent(folderId)}/breadcrumbs`)
}