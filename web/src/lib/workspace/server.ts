import "server-only"

import { cache } from "react"

import type { WorkspaceDetails } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"
import { APIError } from "@/lib/api/types"
import type { Workspace } from "@/lib/workspace/types"

export class WorkspaceAccessError extends Error {
  constructor() {
    super("workspace access denied")
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor() {
    super("workspace not found")
  }
}

export const getWorkspace = cache(async (username: string): Promise<Workspace> => {
  const requested = username.trim()
  if (!requested) throw new WorkspaceNotFoundError()

  try {
    return await apiServerAuthJSON<WorkspaceDetails>(`/workspaces/${encodeURIComponent(requested)}`)
  } catch (error) {
    if (error instanceof APIError) {
      if (error.status === 401 || error.status === 403) throw new WorkspaceAccessError()
      if (error.status === 404) throw new WorkspaceNotFoundError()
    }

    throw error
  }
})