"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { apiJSON } from "@/lib/api/client"
import type { AccessGrant, AccessLevel, AccessLevelInput, CollectionAccess, CollectionAccessGrant, FolderPermissions, LookupUser, LookupUserQuery } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

export type AccessResource = {
  type: "folder" | "collection"
  id: string
  name: string
}

export type AccessGrantRow = Pick<AccessGrant, "userId" | "username" | "name" | "level">

export function useAccessGrants(resource: AccessResource, open: boolean) {
  const [grants, setGrants] = useState<AccessGrantRow[]>([])
  const [username, setUsername] = useState("")
  const [level, setLevel] = useState<AccessLevel>("view")
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [pendingUserId, setPendingUserId] = useState<string>()
  const [removeTarget, setRemoveTarget] = useState<AccessGrantRow>()
  const [removeError, setRemoveError] = useState<string>()
  const [error, setError] = useState<string>()
  const mutating = adding || !!pendingUserId
  const removing = !!removeTarget && pendingUserId === removeTarget.userId

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()

    async function load() {
      try {
        if (resource.type === "folder") {
          const data = await apiJSON<FolderPermissions>(
            `/api/v1/folders/${resource.id}/permissions`,
            { signal: controller.signal },
          )

          if (!controller.signal.aborted) setGrants([...data.permissions])
        } else {
          const data = await apiJSON<CollectionAccess>(
            `/api/v1/collections/${resource.id}/access`,
            { signal: controller.signal },
          )

          if (!controller.signal.aborted) setGrants([...data.access])
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(apiErrorMessage(cause, "Could not load access"))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [open, resource.id, resource.type])

  function reset() {
    setUsername("")
    setError(undefined)
    setLoading(true)
    setRemoveTarget(undefined)
    setRemoveError(undefined)
  }

  async function add() {
    const value = username.trim()
    if (!value || mutating) return

    setAdding(true)
    setError(undefined)

    try {
      const query = { username: value } satisfies LookupUserQuery
      const user = await apiJSON<LookupUser>("/api/v1/users/lookup", { query })
      const grant = await putGrant(user.id, level)

      upsert(grant)
      setUsername("")
      toast.success(`Access granted to ${grant.name} (@${grant.username})`)
    } catch (cause) {
      setError(apiErrorMessage(cause, "Could not grant access"))
    } finally {
      setAdding(false)
    }
  }

  async function update(userId: string, nextLevel: AccessLevel) {
    if (mutating) return

    setPendingUserId(userId)
    setError(undefined)

    try {
      const grant = await putGrant(userId, nextLevel)
      upsert(grant)
      toast.success("Access updated")
    } catch (cause) {
      setError(apiErrorMessage(cause, "Could not update access"))
    } finally {
      setPendingUserId(undefined)
    }
  }

  function openRemove(grant: AccessGrantRow) {
    if (mutating) return
    setRemoveError(undefined)
    setRemoveTarget(grant)
  }

  function changeRemoveOpen(next: boolean) {
    if (removing) return

    if (!next) {
      setRemoveTarget(undefined)
      setRemoveError(undefined)
    }
  }

  async function remove() {
    const grant = removeTarget
    if (!grant || mutating) return

    setPendingUserId(grant.userId)
    setRemoveError(undefined)

    try {
      const path = resource.type === "folder"
        ? `/api/v1/folders/${resource.id}/permissions/${grant.userId}`
        : `/api/v1/collections/${resource.id}/access/${grant.userId}`

      await apiJSON<void>(path, { method: "DELETE" })
      setGrants((current) => current.filter((item) => item.userId !== grant.userId))
      setRemoveTarget(undefined)
      toast.success(`Removed direct access for ${grant.name} (@${grant.username})`)
    } catch (cause) {
      setRemoveError(apiErrorMessage(cause, "Could not remove access"))
    } finally {
      setPendingUserId(undefined)
    }
  }

  async function putGrant(userId: string, nextLevel: AccessLevel) {
    const input = { level: nextLevel } satisfies AccessLevelInput

    if (resource.type === "folder") {
      return apiJSON<AccessGrant>(
        `/api/v1/folders/${resource.id}/permissions/${userId}`,
        { method: "PUT", body: input },
      )
    }

    return apiJSON<CollectionAccessGrant>(
      `/api/v1/collections/${resource.id}/access/${userId}`,
      { method: "PUT", body: input },
    )
  }

  function upsert(grant: AccessGrantRow) {
    setGrants((current) => [
      ...current.filter((item) => item.userId !== grant.userId),
      grant,
    ].sort((a, b) => a.name.localeCompare(b.name) || a.username.localeCompare(b.username)))
  }

  return {
    grants,
    username,
    level,
    loading,
    adding,
    pendingUserId,
    removeTarget,
    removeError,
    error,
    mutating,
    removing,
    setUsername,
    setLevel,
    reset,
    add,
    update,
    openRemove,
    changeRemoveOpen,
    remove,
  }
}