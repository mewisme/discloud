import type { Breadcrumbs, File, FolderChildrenQuery, Node, NodePage, WorkspaceDetails } from "@discloud/api/models"
import type { BrowserOptions } from "@discloud/shared/file-browser"

import { apiJSON } from "#lib/api/transport"

export type DesktopFileBrowserData = {
  workspace: WorkspaceDetails
  folder: Node
  breadcrumbs: readonly Node[]
  page: NodePage
}

export type DesktopFileDetailData = {
  workspace: WorkspaceDetails
  file: File
  breadcrumbs: readonly Node[]
}

export type BrowserQueryOptions = Pick<BrowserOptions, "sort" | "order">

export async function loadDesktopFileBrowser(username: string, folderId: string | undefined, options: BrowserQueryOptions): Promise<DesktopFileBrowserData> {
  const workspace = await apiJSON<WorkspaceDetails>(`/api/v1/workspaces/${encodeURIComponent(username)}`)
  const targetFolderId = folderId ?? workspace.root.id
  const [breadcrumbs, page] = await Promise.all([loadBreadcrumbs(targetFolderId), loadFolderChildren(targetFolderId, options)])
  const folder = breadcrumbs.breadcrumbs.at(-1)

  if (!folder) throw new Error("Folder breadcrumbs are empty.")
  if (!folderId && breadcrumbs.breadcrumbs[0]?.id !== workspace.root.id) {
    throw new Error("Folder does not belong to this workspace.")
  }

  return { workspace, folder, breadcrumbs: breadcrumbs.breadcrumbs, page }
}

export async function loadDesktopFileDetail(username: string, fileId: string): Promise<DesktopFileDetailData> {
  const [workspace, file] = await Promise.all([
    apiJSON<WorkspaceDetails>(`/api/v1/workspaces/${encodeURIComponent(username)}`),
    apiJSON<File>(`/api/v1/files/${encodeURIComponent(fileId)}`),
  ])

  if (file.ownerUserId !== workspace.owner.id) throw new Error("File does not belong to this workspace.")

  const breadcrumbs = await loadBreadcrumbs(file.parentFolderId)
  if (breadcrumbs.breadcrumbs[0]?.id !== workspace.root.id) throw new Error("File does not belong to this workspace.")

  return { workspace, file, breadcrumbs: breadcrumbs.breadcrumbs }
}

export function loadFolderChildren(folderId: string, options: BrowserQueryOptions, cursor?: string) {
  const query = { limit: 50, sort: options.sort, order: options.order, ...(cursor ? { cursor } : {}) } satisfies FolderChildrenQuery
  return apiJSON<NodePage>(`/api/v1/folders/${encodeURIComponent(folderId)}/children`, { query })
}

function loadBreadcrumbs(folderId: string) {
  return apiJSON<Breadcrumbs>(`/api/v1/folders/${encodeURIComponent(folderId)}/breadcrumbs`)
}