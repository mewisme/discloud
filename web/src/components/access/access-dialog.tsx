"use client"

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { Loader2Icon, Share2Icon, Trash2Icon, UserPlusIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiJSON } from "@/lib/api/client"
import type { AccessGrant, AccessLevel, AccessLevelInput, CollectionAccess, CollectionAccessGrant, FolderPermissions, LookupUser, LookupUserQuery } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"

type AccessResource = {
  type: "folder" | "collection"
  id: string
  name: string
}

type Grant = Pick<AccessGrant, "userId" | "username" | "level">

type AccessDialogProps = {
  resource: AccessResource
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode | null
}

export function AccessDialog({ resource, open: controlledOpen, onOpenChange, trigger }: AccessDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [grants, setGrants] = useState<Grant[]>([])
  const [username, setUsername] = useState("")
  const [level, setLevel] = useState<AccessLevel>("view")
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [pendingUserId, setPendingUserId] = useState<string>()
  const [error, setError] = useState<string>()
  const open = controlledOpen ?? internalOpen
  const triggerNode = trigger === undefined ? (
    <Button size="sm" variant="outline">
      <Share2Icon />
      Share
    </Button>
  ) : trigger

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()

    async function load() {
      try {
        if (resource.type === "folder") {
          const data = await apiJSON<FolderPermissions>(`/api/v1/folders/${resource.id}/permissions`, { signal: controller.signal })
          if (!controller.signal.aborted) setGrants([...data.permissions])
        } else {
          const data = await apiJSON<CollectionAccess>(`/api/v1/collections/${resource.id}/access`, { signal: controller.signal })
          if (!controller.signal.aborted) setGrants([...data.access])
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(errorMessage(cause, "Could not load access"))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [open, resource.id, resource.type])

  function changeOpen(next: boolean) {
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)

    if (!next) {
      setUsername("")
      setError(undefined)
      setLoading(true)
    }
  }

  async function add() {
    const value = username.trim()
    if (!value || adding) return
    setAdding(true)
    setError(undefined)

    try {
      const query = { username: value } satisfies LookupUserQuery
      const user = await apiJSON<LookupUser>("/api/v1/users/lookup", { query })
      const grant = await putGrant(user.id, level)
      upsert(grant)
      setUsername("")
      toast.success(`Access granted to ${grant.username}`)
    } catch (cause) {
      setError(errorMessage(cause, "Could not grant access"))
    } finally {
      setAdding(false)
    }
  }

  async function update(userId: string, nextLevel: AccessLevel) {
    setPendingUserId(userId)
    setError(undefined)

    try {
      const grant = await putGrant(userId, nextLevel)
      upsert(grant)
      toast.success("Access updated")
    } catch (cause) {
      setError(errorMessage(cause, "Could not update access"))
    } finally {
      setPendingUserId(undefined)
    }
  }

  async function remove(grant: Grant) {
    setPendingUserId(grant.userId)
    setError(undefined)

    try {
      const path = resource.type === "folder"
        ? `/api/v1/folders/${resource.id}/permissions/${grant.userId}`
        : `/api/v1/collections/${resource.id}/access/${grant.userId}`

      await apiJSON<void>(path, { method: "DELETE" })
      setGrants((current) => current.filter((item) => item.userId !== grant.userId))
      toast.success(`Removed direct access for ${grant.username}`)
    } catch (cause) {
      setError(errorMessage(cause, "Could not remove access"))
    } finally {
      setPendingUserId(undefined)
    }
  }

  async function putGrant(userId: string, nextLevel: AccessLevel) {
    const input = { level: nextLevel } satisfies AccessLevelInput

    if (resource.type === "folder") {
      return apiJSON<AccessGrant>(`/api/v1/folders/${resource.id}/permissions/${userId}`, { method: "PUT", body: input })
    }

    return apiJSON<CollectionAccessGrant>(`/api/v1/collections/${resource.id}/access/${userId}`, { method: "PUT", body: input })
  }

  function upsert(grant: Grant) {
    setGrants((current) => [...current.filter((item) => item.userId !== grant.userId), grant].sort((a, b) => a.username.localeCompare(b.username)))
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {triggerNode && <DialogTrigger asChild>{triggerNode}</DialogTrigger>}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage access</DialogTitle>
          <DialogDescription>Share {resource.name} with another DisCloud user.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={username} autoFocus placeholder="Exact username" disabled={adding} onChange={(event) => setUsername(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void add()
            }
          }} />
          <Select value={level} disabled={adding} onValueChange={(value) => setLevel(value as AccessLevel)}>
            <SelectTrigger className="sm:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="view">View</SelectItem>
              <SelectItem value="edit">Edit</SelectItem>
              <SelectItem value="full">Full</SelectItem>
            </SelectContent>
          </Select>
          <Button disabled={adding || !username.trim()} onClick={() => void add()}>
            {adding ? <Loader2Icon className="animate-spin" /> : <UserPlusIcon />}
            Add
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <p className="text-xs text-muted-foreground">
          View can read. Edit can change content. Full can also manage access.
          {resource.type === "folder" && " Folder access is inherited by descendants; removing a direct grant does not remove access inherited from an ancestor."}
        </p>

        {loading ? (
          <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Loader2Icon className="size-4 animate-spin" />
              Loading access…
            </div>
          </div>
        ) : grants.length === 0 ? (
          <div className="grid min-h-32 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">No direct grants.</div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="w-32">Access</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.map((grant) => (
                  <TableRow key={grant.userId}>
                    <TableCell className="font-medium">{grant.username}</TableCell>
                    <TableCell>
                      <Select value={grant.level} disabled={pendingUserId === grant.userId} onValueChange={(value) => void update(grant.userId, value as AccessLevel)}>
                        <SelectTrigger size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="view">View</SelectItem>
                          <SelectItem value="edit">Edit</SelectItem>
                          <SelectItem value="full">Full</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button size="icon-sm" variant="ghost" disabled={pendingUserId === grant.userId} aria-label={`Remove access for ${grant.username}`} onClick={() => void remove(grant)}>
                        {pendingUserId === grant.userId ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof APIError ? error.message : fallback
}