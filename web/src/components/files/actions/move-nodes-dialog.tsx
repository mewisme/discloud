"use client"

import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@discloud/ui/components/breadcrumb"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@discloud/ui/components/dialog"
import { ChevronRightIcon, FolderIcon, Loader2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { Fragment, useState } from "react"
import { toast } from "sonner"

import { NodeActionError } from "@/components/files/actions/node-action-error"
import { apiJSON } from "@/lib/api/client"
import type { BrowserNode, FolderChildrenQuery, Node, NodePage, UpdateNodeInput } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import type { BrowserOptions, BrowserOrder, BrowserSort } from "@/lib/files/browser"
import { runNodeOperations } from "@/lib/files/node-operations"
import { apiErrorMessage } from "@/lib/helpers"

export function MoveNodesDialog({
  nodes,
  folder,
  breadcrumbs,
  initialPage,
  options,
  open,
  onOpenChange,
  onMoved,
}: {
  nodes: readonly BrowserNode[]
  folder: Node
  breadcrumbs: readonly Node[]
  initialPage: NodePage
  options: BrowserOptions
  open: boolean
  onOpenChange: (open: boolean) => void
  onMoved: (nodeIds: readonly string[]) => void
}) {
  const router = useRouter()
  const [path, setPath] = useState<Node[]>(() => [...breadcrumbs])
  const [page, setPage] = useState<NodePage>(initialPage)
  const [sort, setSort] = useState<BrowserSort>(options.sort)
  const [order, setOrder] = useState<BrowserOrder>(options.order)
  const [loading, setLoading] = useState(false)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string>()
  const current = path[path.length - 1] ?? folder
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
  const single = nodes.length === 1 ? nodes[0] : undefined

  async function navigate(target: Node, pathIndex?: number) {
    if (loading) return

    setLoading(true)
    setError(undefined)

    try {
      const query = { limit: 100, sort: "name", order: "asc" } satisfies FolderChildrenQuery
      const next = await apiJSON<NodePage>(`/api/v1/folders/${target.id}/children`, { query })
      setPage(next)
      setSort("name")
      setOrder("asc")
      setPath((currentPath) => pathIndex == null ? [...currentPath, target] : currentPath.slice(0, pathIndex + 1))
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 401) {
        router.replace("/login")
        router.refresh()
        return
      }

      setError(apiErrorMessage(cause, "Could not open this folder."))
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!page.nextCursor || loading) return

    setLoading(true)

    try {
      const query = { limit: 100, sort, order, cursor: page.nextCursor } satisfies FolderChildrenQuery
      const next = await apiJSON<NodePage>(`/api/v1/folders/${current.id}/children`, { query })

      setPage((currentPage) => ({
        ...next,
        nodes: appendUniqueNodes(currentPage.nodes, next.nodes),
      }))
    } catch (cause) {
      setError(apiErrorMessage(cause, "Could not load more folders."))
    } finally {
      setLoading(false)
    }
  }

  async function move() {
    if (!canMoveHere || moving) return

    const targets = [...nodes]
    setMoving(true)
    setError(undefined)

    try {
      const input: UpdateNodeInput = { parentId: current.id }
      const { successful, errors } = await runNodeOperations(
        targets,
        (node) => apiJSON<Node>(`/api/v1/nodes/${node.id}`, { method: "PATCH", body: input }),
      )

      if (successful.length) onMoved(successful)

      if (errors.some((cause) => cause instanceof APIError && cause.status === 401)) {
        router.replace("/login")
        router.refresh()
        return
      }

      if (errors.length) {
        setError(
          errors.length === 1
            ? apiErrorMessage(errors[0], "Could not move this item.")
            : `${errors.length} of ${targets.length} items could not be moved.`,
        )
        return
      }

      onOpenChange(false)
      toast.success(single ? `${single.name} moved` : `${targets.length} items moved`)
    } finally {
      setMoving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!moving) onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{single ? `Move ${single.name}` : `Move ${nodes.length} items`}</DialogTitle>
          <DialogDescription>Choose another folder in the same ownership domain.</DialogDescription>
        </DialogHeader>

        {error && <NodeActionError message={error} />}

        <Breadcrumb>
          <BreadcrumbList>
            {path.map((item, index) => {
              const active = index === path.length - 1

              return (
                <Fragment key={item.id}>
                  {index > 0 && <BreadcrumbSeparator />}

                  <BreadcrumbItem>
                    {active ? (
                      <BreadcrumbPage>{item.isRoot ? "Files" : item.name}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <button type="button" disabled={loading || moving} onClick={() => void navigate(item, index)}>
                          {item.isRoot ? "Files" : item.name}
                        </button>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-1">
          {loading && page.nodes.length === 0 ? (
            <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
              <Loader2Icon className="mr-2 size-4 animate-spin" />
              Loading…
            </div>
          ) : folders.length === 0 ? (
            <div className="grid h-28 place-items-center text-sm text-muted-foreground">No child folders here.</div>
          ) : (
            folders.map((item) => (
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
            ))
          )}

          {page.nextCursor && (
            <Button type="button" variant="ghost" className="w-full" disabled={loading || moving} onClick={() => void loadMore()}>
              {loading && <Loader2Icon className="animate-spin" />}
              Load more
            </Button>
          )}
        </div>

        {!canMoveHere && (
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
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={moving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>

          <Button type="button" disabled={!canMoveHere || moving} onClick={() => void move()}>
            {moving && <Loader2Icon className="animate-spin" />}
            {single ? "Move here" : `Move ${nodes.length} items here`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function appendUniqueNodes(current: readonly BrowserNode[], incoming: readonly BrowserNode[]) {
  const ids = new Set(current.map((node) => node.id))
  return [...current, ...incoming.filter((node) => !ids.has(node.id))]
}