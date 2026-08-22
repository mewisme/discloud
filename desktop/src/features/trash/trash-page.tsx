import type { Node, TrashItem, TrashPage, TrashQuery, WorkspaceDetails } from "@discloud/api/models"
import { formatBytes, formatDate } from "@discloud/shared/format"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@discloud/ui/components/alert-dialog"
import { Button } from "@discloud/ui/components/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { FileIcon, FolderIcon, Loader2Icon, RotateCcwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useParams } from "react-router"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { loadDesktopWorkspace } from "../workspace/api"

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; workspace: WorkspaceDetails; page: TrashPage }

export function DesktopTrashPage() {
  const { username } = useParams()
  const [state, setState] = useState<State>({ status: "loading" })
  const [loadingMore, setLoadingMore] = useState(false)
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [deleteTarget, setDeleteTarget] = useState<TrashItem>()
  const [actionError, setActionError] = useState<string>()
  const deleting = deleteTarget ? pending.has(deleteTarget.node.id) : false

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!username) {
        setState({ status: "error", message: "Workspace username is missing." })
        return
      }

      try {
        const workspace = await loadDesktopWorkspace(username)
        const page = await apiJSON<TrashPage>("/api/v1/trash", { query: trashQuery(workspace.owner.id) })
        if (!cancelled) setState({ status: "ready", workspace, page })
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [username])

  function setItemPending(id: string, value: boolean) {
    setPending((current) => {
      const next = new Set(current)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.page.nextCursor || loadingMore) return

    setLoadingMore(true)
    setActionError(undefined)

    try {
      const page = await apiJSON<TrashPage>("/api/v1/trash", { query: trashQuery(state.workspace.owner.id, state.page.nextCursor) })
      setState((current) => current.status === "ready"
        ? { ...current, page: { ...page, items: [...current.page.items, ...page.items] } }
        : current)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setLoadingMore(false)
    }
  }

  async function restore(item: TrashItem) {
    if (pending.has(item.node.id)) return

    setItemPending(item.node.id, true)
    setActionError(undefined)

    try {
      await apiJSON<Node>(restorePath(item), { method: "POST" })
      removeItem(item.node.id)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setItemPending(item.node.id, false)
    }
  }

  async function deleteForever(item: TrashItem) {
    if (pending.has(item.node.id)) return

    setItemPending(item.node.id, true)
    setActionError(undefined)

    try {
      await apiJSON<void>(permanentPath(item), { method: "DELETE" })
      removeItem(item.node.id)
      setDeleteTarget(undefined)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setItemPending(item.node.id, false)
    }
  }

  function removeItem(id: string) {
    setState((current) => current.status === "ready"
      ? { ...current, page: { ...current.page, items: current.page.items.filter((item) => item.node.id !== id) } }
      : current)
  }

  if (state.status === "loading") return <div className="grid min-h-64 place-items-center"><Loader2Icon className="animate-spin text-muted-foreground" /></div>
  if (state.status === "error") return <p role="alert" className="text-sm text-destructive">{state.message}</p>

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
        <p className="text-sm text-muted-foreground">Deleted files and folders owned by @{state.workspace.owner.username}.</p>
      </div>

      {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}

      {state.page.items.length === 0 && !state.page.nextCursor ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div>
            <Trash2Icon className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium">Trash is empty</p>
            <p className="mt-1 text-sm text-muted-foreground">Files and folders moved to trash will appear here.</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Type</TableHead>
                <TableHead className="hidden md:table-cell">Size</TableHead>
                <TableHead className="hidden lg:table-cell">Deleted</TableHead>
                <TableHead className="w-56" />
              </TableRow>
            </TableHeader>

            <TableBody>
              {state.page.items.map((item) => {
                const itemPending = pending.has(item.node.id)

                return (
                  <TableRow key={item.node.id}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        {item.node.kind === "folder" ? <FolderIcon className="size-4 shrink-0" /> : <FileIcon className="size-4 shrink-0" />}
                        <span className="truncate font-medium">{item.node.name}</span>
                      </div>
                    </TableCell>

                    <TableCell className="hidden capitalize text-muted-foreground sm:table-cell">{item.node.kind}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{item.sizeBytes == null ? "—" : formatBytes(item.sizeBytes)}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(item.deletedAt)}</TableCell>

                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" disabled={itemPending} onClick={() => void restore(item)}>
                          {itemPending ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
                          Restore
                        </Button>

                        <Button size="icon-sm" variant="destructive" disabled={itemPending} aria-label={`Delete ${item.node.name} forever`} onClick={() => setDeleteTarget(item)}>
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>

          {state.page.nextCursor ? (
            <div className="flex justify-center border-t p-3">
              <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? <Loader2Icon className="animate-spin" /> : null}
                {loadingMore ? "Loading" : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => {
        if (!open && !deleting) setDeleteTarget(undefined)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <TriangleAlertIcon />
            <AlertDialogTitle>Delete {deleteTarget?.node.name} forever?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.node.kind === "folder"
                ? "This permanently removes the folder, all of its children, and their DisCloud database records. This cannot be undone."
                : "This permanently removes the file and its DisCloud database records. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Discord messages and attachments are intentionally left untouched. Unreferenced chunk records are removed only from the DisCloud database.
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={!deleteTarget || deleting} onClick={() => deleteTarget && void deleteForever(deleteTarget)}>
              {deleting ? <Loader2Icon className="animate-spin" /> : null}
              Delete forever
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function trashQuery(ownerId: string, cursor?: string): TrashQuery {
  return { ownerId, limit: 50, cursor }
}

function restorePath(item: TrashItem) {
  const id = encodeURIComponent(item.node.id)
  return item.node.kind === "folder" ? `/api/v1/folders/${id}/restore` : `/api/v1/files/${id}/restore`
}

function permanentPath(item: TrashItem) {
  const id = encodeURIComponent(item.node.id)
  return item.node.kind === "folder" ? `/api/v1/folders/${id}/permanent` : `/api/v1/files/${id}/permanent`
}