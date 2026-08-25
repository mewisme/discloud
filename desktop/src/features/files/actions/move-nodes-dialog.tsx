import type { BrowserNode, FolderChildrenQuery, Node, NodePage, UpdateNodeInput } from "@discloud/api/models"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@discloud/ui/components/dialog"
import { ChevronRightIcon, FolderIcon, Loader2Icon } from "lucide-react"
import { useState } from "react"

import { DesktopPaginationTrigger } from "#components/pagination-trigger"
import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

export function DesktopMoveNodesDialog({
  nodes,
  folder,
  breadcrumbs,
  initialPage,
  open,
  onOpenChange,
  onMoved,
}: {
  nodes: readonly BrowserNode[]
  folder: Node
  breadcrumbs: readonly Node[]
  initialPage: NodePage
  open: boolean
  onOpenChange: (open: boolean) => void
  onMoved: (nodeIds: readonly string[]) => void
}) {
  const [path, setPath] = useState<Node[]>(() => [...breadcrumbs])
  const [page, setPage] = useState<NodePage>(initialPage)
  const [loading, setLoading] = useState(false)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string>()
  const current = path.at(-1) ?? folder
  const ownerUserId = nodes[0]?.ownerUserId
  const selectedIds = new Set(nodes.map((node) => node.id))
  const sameOwner = !!ownerUserId && nodes.every((node) => node.ownerUserId === ownerUserId)
  const editable = nodes.length > 0 && nodes.every((node) => node.accessLevel !== "view")
  const folders = page.nodes.filter((item) => item.kind === "folder" && !selectedIds.has(item.id) && item.ownerUserId === ownerUserId)
  const canMoveHere = editable
    && sameOwner
    && page.accessLevel !== "view"
    && current.ownerUserId === ownerUserId
    && nodes.every((node) => current.id !== node.id && current.id !== node.parentId)

  async function navigate(target: Node, pathIndex?: number) {
    if (loading || moving) return

    setLoading(true)
    setError(undefined)

    try {
      const query = {
        limit: 100,
        sort: "name",
        order: "asc",
      } satisfies FolderChildrenQuery

      const next = await apiJSON<NodePage>(`/api/v1/folders/${encodeURIComponent(target.id)}/children`, { query })

      setPage(next)
      setPath((currentPath) => pathIndex == null ? [...currentPath, target] : currentPath.slice(0, pathIndex + 1))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!page.nextCursor || loading || moving) return

    setLoading(true)
    setError(undefined)

    try {
      const query = {
        limit: 100,
        sort: "name",
        order: "asc",
        cursor: page.nextCursor,
      } satisfies FolderChildrenQuery

      const next = await apiJSON<NodePage>(`/api/v1/folders/${encodeURIComponent(current.id)}/children`, { query })
      const ids = new Set(page.nodes.map((node) => node.id))

      setPage({
        ...next,
        nodes: [
          ...page.nodes,
          ...next.nodes.filter((node) => !ids.has(node.id)),
        ],
      })
    } catch (cause) {
      setError(errorMessage(cause))
      throw cause
    } finally {
      setLoading(false)
    }
  }

  async function move() {
    if (!canMoveHere || moving) return

    setMoving(true)
    setError(undefined)

    const input = { parentId: current.id } satisfies UpdateNodeInput
    const successful: string[] = []
    const errors: unknown[] = []

    for (const node of nodes) {
      try {
        await apiJSON<Node>(`/api/v1/nodes/${encodeURIComponent(node.id)}`, {
          method: "PATCH",
          body: input,
        })

        successful.push(node.id)
      } catch (cause) {
        errors.push(cause)
      }
    }

    if (successful.length) onMoved(successful)

    if (errors.length) {
      setError(
        errors.length === 1
          ? errorMessage(errors[0])
          : `${errors.length} of ${nodes.length} items could not be moved.`,
      )
      setMoving(false)
      return
    }

    setMoving(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!moving) onOpenChange(next)
    }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{nodes.length === 1 ? `Move ${nodes[0].name}` : `Move ${nodes.length} items`}</DialogTitle>
          <DialogDescription>Choose another folder in the same ownership domain.</DialogDescription>
        </DialogHeader>

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-wrap gap-1 text-sm">
          {path.map((item, index) => (
            <Button
              key={item.id}
              size="sm"
              variant={index === path.length - 1 ? "secondary" : "ghost"}
              disabled={loading || moving}
              onClick={() => void navigate(item, index)}
            >
              {item.isRoot ? "Files" : item.name}
            </Button>
          ))}
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-1">
          {loading && !page.nodes.length ? (
            <div className="grid h-28 place-items-center">
              <Loader2Icon className="animate-spin text-muted-foreground" />
            </div>
          ) : folders.length === 0 ? (
            <div className="grid h-28 place-items-center text-sm text-muted-foreground">No child folders here.</div>
          ) : folders.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={loading || moving}
              onClick={() => void navigate(item)}
            >
              <FolderIcon />
              <span className="truncate">{item.name}</span>
              <ChevronRightIcon className="ml-auto" />
            </Button>
          ))}

          {page.nextCursor ? <DesktopPaginationTrigger loadKey={page.nextCursor} hasMore loading={loading || moving} onLoadMore={loadMore} className="py-1" loadingLabel="Loading more folders…" /> : null}
        </div>

        {!canMoveHere ? (
          <p className="text-xs text-muted-foreground">
            {!sameOwner
              ? "All selected items must belong to the same owner."
              : !editable
                ? "You do not have permission to move every selected item."
                : nodes.some((node) => node.parentId === current.id)
                  ? "The selected items are already in this folder."
                  : page.accessLevel === "view"
                    ? "You only have view access to this folder."
                    : "This folder cannot be used as the destination."}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={moving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!canMoveHere || moving} onClick={() => void move()}>
            {moving ? <Loader2Icon className="animate-spin" /> : null}
            {nodes.length === 1 ? "Move here" : `Move ${nodes.length} items here`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}