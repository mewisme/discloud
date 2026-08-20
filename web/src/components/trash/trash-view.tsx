"use client"

import { useState } from "react"
import { FileIcon, FolderIcon, Loader2Icon, RotateCcwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiJSON } from "@/lib/api/client"
import type { Node, TrashItem, TrashPage, TrashQuery } from "@/lib/api/models"
import { apiErrorMessage, formatBytes, formatDateTime } from "@/lib/helpers"

const pageSize = 50

export function TrashView({ initialPage, ownerId }: { initialPage: TrashPage; ownerId: string }) {
  const router = useRouter()
  const [items, setItems] = useState<TrashItem[]>(() => [...initialPage.items])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [deleteTarget, setDeleteTarget] = useState<TrashItem>()
  const deleting = deleteTarget ? pending.has(deleteTarget.node.id) : false

  function setItemPending(id: string, value: boolean) {
    setPending((current) => {
      const next = new Set(current)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function loadMore() {
    if (!nextCursor || loading) return
    setLoading(true)

    try {
      const query = { ownerId, limit: pageSize, cursor: nextCursor } satisfies TrashQuery
      const page = await apiJSON<TrashPage>("/api/v1/trash", { query })
      setItems((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load more trash items."))
    } finally {
      setLoading(false)
    }
  }

  async function restore(item: TrashItem) {
    const id = item.node.id
    if (pending.has(id)) return
    setItemPending(id, true)

    try {
      await apiJSON<Node>(restorePath(item), { method: "POST" })
      setItems((current) => current.filter((candidate) => candidate.node.id !== id))
      toast.success(`${item.node.name} restored`)
      router.refresh()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not restore this item."))
    } finally {
      setItemPending(id, false)
    }
  }

  async function deleteForever(item: TrashItem) {
    const id = item.node.id
    if (pending.has(id)) return
    setItemPending(id, true)

    try {
      await apiJSON<void>(permanentPath(item), { method: "DELETE" })
      setItems((current) => current.filter((candidate) => candidate.node.id !== id))
      setDeleteTarget(undefined)
      toast.success(`${item.node.name} permanently deleted`)
      router.refresh()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not permanently delete this item."))
    } finally {
      setItemPending(id, false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
        <p className="text-sm text-muted-foreground">Restore files and folders or permanently remove their DisCloud database records.</p>
      </div>

      {items.length === 0 && !nextCursor ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div className="space-y-3">
            <Trash2Icon className="mx-auto size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">Trash is empty</p>
              <p className="text-sm text-muted-foreground">Files and folders you move to trash will appear here.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden w-24 sm:table-cell">Type</TableHead>
                <TableHead className="hidden w-28 md:table-cell">Size</TableHead>
                <TableHead className="hidden w-44 lg:table-cell">Deleted</TableHead>
                <TableHead className="w-56" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const itemPending = pending.has(item.node.id)

                return (
                  <TableRow key={`${item.node.kind}:${item.node.id}`}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        {item.node.kind === "folder" ? <FolderIcon className="size-4 shrink-0" /> : <FileIcon className="size-4 shrink-0" />}
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.node.name}</p>
                          <p className="truncate text-xs capitalize text-muted-foreground sm:hidden">{item.node.kind}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden capitalize text-muted-foreground sm:table-cell">{item.node.kind}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{item.sizeBytes == null ? "—" : formatBytes(item.sizeBytes)}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell" title={item.deletedAt}>{formatDateTime(item.deletedAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" disabled={itemPending} onClick={() => void restore(item)}>
                          {itemPending ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
                          Restore
                        </Button>
                        <Button size="icon-sm" variant="destructive" disabled={itemPending} aria-label={`Delete ${item.node.name} forever`} title="Delete forever" onClick={() => setDeleteTarget(item)}>
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>

          {nextCursor && (
            <div className="flex justify-center border-t p-3">
              <Button variant="ghost" disabled={loading} onClick={() => void loadMore()}>
                {loading && <Loader2Icon className="animate-spin" />}
                Load more
              </Button>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => {
        if (!open && !deleting) setDeleteTarget(undefined)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlertIcon />
            </AlertDialogMedia>
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
              {deleting && <Loader2Icon className="animate-spin" />}
              Delete forever
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function restorePath(item: TrashItem) {
  const id = encodeURIComponent(item.node.id)
  return item.node.kind === "folder" ? `/api/v1/folders/${id}/restore` : `/api/v1/files/${id}/restore`
}

function permanentPath(item: TrashItem) {
  const id = encodeURIComponent(item.node.id)
  return item.node.kind === "folder" ? `/api/v1/folders/${id}/permanent` : `/api/v1/files/${id}/permanent`
}