"use client"

import { useState } from "react"
import { FileIcon, FolderIcon, Loader2Icon, RotateCcwIcon, Trash2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
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
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(() => new Set())

  function setRestorePending(id: string, pending: boolean) {
    setRestoring((current) => {
      const next = new Set(current)
      if (pending) next.add(id)
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
    if (restoring.has(id)) return

    setRestorePending(id, true)

    try {
      await apiJSON<Node>(restorePath(item), { method: "POST" })
      setItems((current) => current.filter((candidate) => candidate.node.id !== id))
      toast.success(`${item.node.name} restored`)
      router.refresh()
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not restore this item."))
    } finally {
      setRestorePending(id, false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
        <p className="text-sm text-muted-foreground">Restore files and folders that were moved to trash.</p>
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
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const pending = restoring.has(item.node.id)

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
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => void restore(item)}>
                        {pending ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
                        Restore
                      </Button>
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
    </div>
  )
}

function restorePath(item: TrashItem) {
  const id = encodeURIComponent(item.node.id)
  return item.node.kind === "folder" ? `/api/v1/folders/${id}/restore` : `/api/v1/files/${id}/restore`
}