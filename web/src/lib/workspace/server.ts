import "server-only"

import { cache } from "react"

import type { CurrentUserRoot, CurrentUserUsage, LookupUser, LookupUserQuery, Node, RootFolder, UserUsage } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"
import { APIError } from "@/lib/api/types"
import { getCurrentUser } from "@/lib/auth/session"
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
  const currentUser = await getCurrentUser()
  if (!currentUser) throw new WorkspaceAccessError()

  const requested = username.trim()

  if (requested.localeCompare(currentUser.username, undefined, { sensitivity: "accent" }) === 0) {
    const [root, usage] = await Promise.all([
      apiServerAuthJSON<CurrentUserRoot>("/me/root"),
      apiServerAuthJSON<CurrentUserUsage>("/me/usage"),
    ])

    return {
      owner: {
        id: currentUser.id,
        username: currentUser.username,
      },
      root,
      usage,
    }
  }

  if (currentUser.role !== "admin") throw new WorkspaceAccessError()

  let owner: LookupUser

  try {
    const query = { username: requested } satisfies LookupUserQuery
    owner = await apiServerAuthJSON<LookupUser>("/users/lookup", { query })
  } catch (error) {
    if (error instanceof APIError && error.status === 404) throw new WorkspaceNotFoundError()
    throw error
  }

  try {
    const [rootReference, usage] = await Promise.all([
      apiServerAuthJSON<RootFolder>(`/admin/users/${encodeURIComponent(owner.id)}/root`),
      apiServerAuthJSON<UserUsage>(`/admin/users/${encodeURIComponent(owner.id)}/usage`),
    ])

    const root = await apiServerAuthJSON<Node>(`/folders/${encodeURIComponent(rootReference.id)}`)

    return {
      owner,
      root,
      usage,
    }
  } catch (error) {
    if (error instanceof APIError && error.status === 404) throw new WorkspaceNotFoundError()
    throw error
  }
})