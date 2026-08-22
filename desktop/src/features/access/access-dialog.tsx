import type { AccessGrant, AccessLevel, AccessLevelInput, CollectionAccess, CollectionAccessGrant, FolderPermissions, LookupUser, LookupUserQuery } from "@discloud/api/models"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@discloud/ui/components/dialog"
import { Input } from "@discloud/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Loader2Icon, Share2Icon, Trash2Icon } from "lucide-react"
import type { FormEvent, ReactNode } from "react"
import { useEffect, useState } from "react"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

export type AccessResource = {
  type: "folder" | "collection"
  id: string
  name: string
}

type AccessGrantRow = Pick<AccessGrant, "userId" | "username" | "name" | "level">

export function DesktopAccessDialog({
  resource,
  open: controlledOpen,
  onOpenChange,
  trigger,
}: {
  resource: AccessResource
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode | null
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [grants, setGrants] = useState<AccessGrantRow[]>([])
  const [username, setUsername] = useState("")
  const [level, setLevel] = useState<AccessLevel>("view")
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [pendingUserId, setPendingUserId] = useState<string>()
  const [error, setError] = useState<string>()
  const open = controlledOpen ?? internalOpen
  const mutating = adding || !!pendingUserId
  const triggerNode = trigger === undefined ? (
    <Button size="sm" variant="outline">
      <Share2Icon />
      Share
    </Button>
  ) : trigger

  useEffect(() => {
    if (!open) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError(undefined)

      try {
        if (resource.type === "folder") {
          const data = await apiJSON<FolderPermissions>(`/api/v1/folders/${encodeURIComponent(resource.id)}/permissions`)
          if (!cancelled) setGrants([...data.permissions])
        } else {
          const data = await apiJSON<CollectionAccess>(`/api/v1/collections/${encodeURIComponent(resource.id)}/access`)
          if (!cancelled) setGrants([...data.access])
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [open, resource.id, resource.type])

  function changeOpen(next: boolean) {
    if (!next && mutating) return
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)

    if (!next) {
      setUsername("")
      setLevel("view")
      setError(undefined)
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault()

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
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setAdding(false)
    }
  }

  async function update(userId: string, nextLevel: AccessLevel) {
    if (mutating) return

    setPendingUserId(userId)
    setError(undefined)

    try {
      upsert(await putGrant(userId, nextLevel))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPendingUserId(undefined)
    }
  }

  async function remove(userId: string) {
    if (mutating) return

    setPendingUserId(userId)
    setError(undefined)

    try {
      const path = resource.type === "folder"
        ? `/api/v1/folders/${encodeURIComponent(resource.id)}/permissions/${encodeURIComponent(userId)}`
        : `/api/v1/collections/${encodeURIComponent(resource.id)}/access/${encodeURIComponent(userId)}`

      await apiJSON<void>(path, { method: "DELETE" })
      setGrants((current) => current.filter((grant) => grant.userId !== userId))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPendingUserId(undefined)
    }
  }

  async function putGrant(userId: string, nextLevel: AccessLevel) {
    const input = { level: nextLevel } satisfies AccessLevelInput

    if (resource.type === "folder") {
      return apiJSON<AccessGrant>(
        `/api/v1/folders/${encodeURIComponent(resource.id)}/permissions/${encodeURIComponent(userId)}`,
        { method: "PUT", body: input },
      )
    }

    return apiJSON<CollectionAccessGrant>(
      `/api/v1/collections/${encodeURIComponent(resource.id)}/access/${encodeURIComponent(userId)}`,
      { method: "PUT", body: input },
    )
  }

  function upsert(grant: AccessGrantRow) {
    setGrants((current) => [
      ...current.filter((item) => item.userId !== grant.userId),
      grant,
    ].sort((left, right) => left.name.localeCompare(right.name) || left.username.localeCompare(right.username)))
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {triggerNode ? <DialogTrigger asChild>{triggerNode}</DialogTrigger> : null}

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage access</DialogTitle>
          <DialogDescription>Share {resource.name} with another DisCloud user.</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={add}>
          <Input
            value={username}
            disabled={mutating}
            placeholder="Exact username"
            aria-label="Username"
            onChange={(event) => setUsername(event.target.value)}
          />

          <Select value={level} disabled={mutating} onValueChange={(value) => setLevel(value as AccessLevel)}>
            <SelectTrigger className="sm:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="view">View</SelectItem>
              <SelectItem value="edit">Edit</SelectItem>
              <SelectItem value="full">Full</SelectItem>
            </SelectContent>
          </Select>

          <Button type="submit" disabled={!username.trim() || mutating}>
            {adding ? <Loader2Icon className="animate-spin" /> : <Share2Icon />}
            Add
          </Button>
        </form>

        <p className="text-xs text-muted-foreground">
          View can read. Edit can change content. Full can also manage access.
          {resource.type === "folder" ? " Folder access is inherited by descendants." : ""}
        </p>

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        {loading ? (
          <div className="grid min-h-40 place-items-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="animate-spin" />
              Loading access
            </div>
          </div>
        ) : grants.length === 0 ? (
          <div className="grid min-h-32 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No direct grants.
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {grants.map((grant) => {
              const pending = pendingUserId === grant.userId

              return (
                <div key={grant.userId} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{grant.name}</p>
                    <p className="truncate text-xs text-muted-foreground">@{grant.username}</p>
                  </div>

                  <Select value={grant.level} disabled={mutating} onValueChange={(value) => void update(grant.userId, value as AccessLevel)}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">View</SelectItem>
                      <SelectItem value="edit">Edit</SelectItem>
                      <SelectItem value="full">Full</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={mutating}
                    aria-label={`Remove ${grant.username}`}
                    title="Remove access"
                    onClick={() => void remove(grant.userId)}
                  >
                    {pending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}