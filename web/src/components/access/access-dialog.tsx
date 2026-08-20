"use client"

import { Loader2Icon, Share2Icon, Trash2Icon, UserPlusIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiJSON } from "@/lib/api/client"
import type { AccessGrant, AccessLevel, AccessLevelInput, CollectionAccess, CollectionAccessGrant, FolderPermissions, LookupUser, LookupUserQuery } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

type AccessResource = {
  type: "folder" | "collection"
  id: string
  name: string
}

type Grant = Pick<AccessGrant, "userId" | "username" | "name" | "level">

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
  const [removeTarget, setRemoveTarget] = useState<Grant>()
  const [removeError, setRemoveError] = useState<string>()
  const [error, setError] = useState<string>()
  const open = controlledOpen ?? internalOpen
  const mutating = adding || !!pendingUserId
  const removing = !!removeTarget && pendingUserId === removeTarget.userId
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
        if (!controller.signal.aborted) setError(apiErrorMessage(cause, "Could not load access"))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [open, resource.id, resource.type])

  function changeOpen(next: boolean) {
    if (!next && mutating) return

    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)

    if (!next) {
      setUsername("")
      setError(undefined)
      setLoading(true)
      setRemoveTarget(undefined)
      setRemoveError(undefined)
    }
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

  function openRemove(grant: Grant) {
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
      return apiJSON<AccessGrant>(`/api/v1/folders/${resource.id}/permissions/${userId}`, { method: "PUT", body: input })
    }

    return apiJSON<CollectionAccessGrant>(`/api/v1/collections/${resource.id}/access/${userId}`, { method: "PUT", body: input })
  }

  function upsert(grant: Grant) {
    setGrants((current) => [...current.filter((item) => item.userId !== grant.userId), grant]
      .sort((a, b) => a.name.localeCompare(b.name) || a.username.localeCompare(b.username)))
  }

  return (
    <>
      <Dialog open={open} onOpenChange={changeOpen}>
        {triggerNode && <DialogTrigger asChild>{triggerNode}</DialogTrigger>}

        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage access</DialogTitle>
            <DialogDescription>Share {resource.name} with another DisCloud user.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={username}
              autoFocus
              placeholder="Exact username"
              disabled={mutating}
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void add()
                }
              }}
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

            <Button disabled={mutating || !username.trim()} onClick={() => void add()}>
              {adding ? <Loader2Icon className="animate-spin" /> : <UserPlusIcon />}
              {adding ? "Adding…" : "Add"}
            </Button>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <p className="text-xs text-muted-foreground">
            Enter the exact username to add a user. View can read. Edit can change content. Full can also manage access.
            {resource.type === "folder" && " Folder access is inherited by descendants; removing a direct grant does not remove access inherited from an ancestor."}
          </p>

          {loading ? (
            <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
              <div role="status" className="flex items-center gap-2">
                <Loader2Icon className="size-4 animate-spin" />
                Loading access…
              </div>
            </div>
          ) : grants.length === 0 ? (
            <div className="grid min-h-32 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">No direct grants.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="w-32">Access</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {grants.map((grant) => (
                    <TableRow key={grant.userId}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{grant.name}</p>
                          <p className="truncate text-xs text-muted-foreground">@{grant.username}</p>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Select value={grant.level} disabled={mutating} onValueChange={(value) => void update(grant.userId, value as AccessLevel)}>
                          <SelectTrigger size="sm" aria-label={`Access level for ${grant.name} (@${grant.username})`}>
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
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={mutating}
                          aria-label={`Remove access for ${grant.name} (@${grant.username})`}
                          onClick={() => openRemove(grant)}
                        >
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

      <AlertDialog open={!!removeTarget} onOpenChange={changeRemoveOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2Icon />
            </AlertDialogMedia>

            <AlertDialogTitle>Remove access?</AlertDialogTitle>

            <AlertDialogDescription>
              {removeTarget
                ? `Remove direct access to ${resource.name} for ${removeTarget.name} (@${removeTarget.username})?`
                : "Remove this direct access grant?"}
              {resource.type === "folder" && " Access inherited from another folder will remain unchanged."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {removeError && (
            <p role="alert" className="text-sm text-destructive">
              {removeError}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={removing} onClick={() => void remove()}>
              {removing && <Loader2Icon className="animate-spin" />}
              {removing ? "Removing…" : "Remove access"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}