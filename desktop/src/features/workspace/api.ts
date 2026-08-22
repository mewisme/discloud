import type { WorkspaceDetails } from "@discloud/api/models"

import { apiJSON } from "#lib/api/transport"

export function loadDesktopWorkspace(username: string) {
  return apiJSON<WorkspaceDetails>(`/api/v1/workspaces/${encodeURIComponent(username)}`)
}