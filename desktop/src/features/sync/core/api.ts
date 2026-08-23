import type { Node } from "@discloud/api/models"

import { apiJSON } from "#lib/api/transport"

export async function resolveSyncRemoteFolder(folderId: string) {
  const value = folderId.trim()
  const folder = value
    ? await apiJSON<Node>(`/api/v1/folders/${encodeURIComponent(value)}`)
    : await apiJSON<Node>("/api/v1/me/root")

  if (folder.kind !== "folder") throw new Error("The selected remote resource is not a folder.")
  return folder
}
