"use client"

import { Loader2Icon, MoreHorizontalIcon, MoveIcon, StarIcon, StarOffIcon, Trash2Icon, XIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { toast } from "sonner"

import { FileBrowserChrome } from "@/components/files/file-browser-chrome"
import { BrowserItems } from "@/components/files/file-browser-items"
import { MoveNodesDialog, TrashNodesDialog } from "@/components/files/node-actions"
import { useUserConfig } from "@/components/settings/user-config-context"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { UPLOAD_COMPLETED_EVENT, type UploadCompletedDetail } from "@/components/uploads/upload-provider"
import { FileUploadTarget } from "@/components/uploads/upload-target"
import { apiJSON } from "@/lib/api/client"
import type { Breadcrumbs, BrowserNode, CurrentUserRoot, FolderChildrenQuery, Node, NodePage } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { type BrowserOptions, browserURL } from "@/lib/files/browser"
import { folderBrowserPath, folderIdFromBrowserPath } from "@/lib/files/navigation"
import { cn } from "@/lib/utils"

type FileBrowserProps = {
  folder: Node
  breadcrumbs: readonly Node[]
  initialPage: NodePage
  options: BrowserOptions
}

type HistoryMode = "push" | "replace" | "none"

export function FileBrowser({ folder: initialFolder, breadcrumbs: initialBreadcrumbs, initialPage, options: initialOptions }: FileBrowserProps) {
  const router = useRouter()
  const { config } = useUserConfig()
  const [folder, setFolder] = useState(initialFolder)
  const [breadcrumbs, setBreadcrumbs] = useState<readonly Node[]>(initialBreadcrumbs)
  const [nodes, setNodes] = useState<BrowserNode[]>(() => [...initialPage.nodes])
  const [accessLevel, setAccessLevel] = useState(initialPage.accessLevel)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [options, setOptions] = useState(initialOptions)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [tableLoading, setTableLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [favoritePending, setFavoritePending] = useState(false)
  const [moveTargets, setMoveTargets] = useState<BrowserNode[]>()
  const [trashTargets, setTrashTargets] = useState<BrowserNode[]>()
  const mainController = useRef<AbortController | null>(null)
  const moreController = useRef<AbortController | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const selectedNodes = nodes.filter((node) => selected.has(node.id))
  const toolbarConfig = config.common.fileBrowserToolbar
  const horizontalToolbarDocked = toolbarConfig.variant === "dock" && toolbarConfig.dockPosition === "bottom"
  const rightToolbarDocked = toolbarConfig.variant === "dock" && toolbarConfig.dockPosition === "right"
  const mergeHorizontalDocks = horizontalToolbarDocked && selectedNodes.length > 0
  const bulkEditable = selectedNodes.length > 0 && selectedNodes.every((node) => node.accessLevel !== "view")
  const bulkSameOwner = selectedNodes.length > 0 && selectedNodes.every((node) => node.ownerUserId === selectedNodes[0].ownerUserId)
  const bulkCanMove = bulkEditable && bulkSameOwner
  const bulkCanTrash = bulkEditable
  const bulkCanFavorite = selectedNodes.some((node) => node.canFavorite && !node.isFavorite)
  const bulkCanUnfavorite = selectedNodes.some((node) => node.canFavorite && node.isFavorite)
  const hasBulkActions = bulkCanMove || bulkCanTrash || bulkCanFavorite || bulkCanUnfavorite
  const browserShortcutsEnabled = !moveTargets && !trashTargets && !favoritePending && !tableLoading
  const currentPage: NodePage = { nodes, accessLevel, ...(nextCursor ? { nextCursor } : {}) }

  const reloadChildren = useCallback(async (targetOptions = options) => {
    mainController.current?.abort()
    moreController.current?.abort()

    const controller = new AbortController()
    mainController.current = controller
    setTableLoading(true)

    try {
      const page = await loadChildren(folder.id, targetOptions, controller.signal)
      if (controller.signal.aborted) return

      setNodes([...page.nodes])
      setAccessLevel(page.accessLevel)
      setNextCursor(page.nextCursor)
      setSelected(new Set())
    } finally {
      if (mainController.current === controller) {
        mainController.current = null
        setTableLoading(false)
      }
    }
  }, [folder.id, options])

  const navigateFolder = useCallback(async (targetFolderId: string | undefined, historyMode: HistoryMode = "push") => {
    mainController.current?.abort()
    moreController.current?.abort()

    const controller = new AbortController()
    mainController.current = controller
    setTableLoading(true)

    try {
      let folderId = targetFolderId

      if (!folderId) {
        const root = await apiJSON<CurrentUserRoot>("/api/v1/me/root", { signal: controller.signal })
        folderId = root.id
      }

      const query = { limit: 50, sort: options.sort, order: options.order } satisfies FolderChildrenQuery
      const [trail, page] = await Promise.all([
        apiJSON<Breadcrumbs>(`/api/v1/folders/${folderId}/breadcrumbs`, { signal: controller.signal }),
        apiJSON<NodePage>(`/api/v1/folders/${folderId}/children`, { query, signal: controller.signal }),
      ])

      if (controller.signal.aborted) return

      const nextFolder = trail.breadcrumbs.at(-1)
      if (!nextFolder) throw new Error("Folder breadcrumbs are empty")

      setFolder(nextFolder)
      setBreadcrumbs([...trail.breadcrumbs])
      setNodes([...page.nodes])
      setAccessLevel(page.accessLevel)
      setNextCursor(page.nextCursor)
      setSelected(new Set())

      if (historyMode !== "none") {
        const url = browserURL(folderBrowserPath(nextFolder.id), options)
        if (historyMode === "push") window.history.pushState(null, "", url)
        else window.history.replaceState(null, "", url)
      }
    } catch (error) {
      if (controller.signal.aborted) return
      handleBrowserError(error, router, "Could not open this folder")
    } finally {
      if (mainController.current === controller) {
        mainController.current = null
        setTableLoading(false)
      }
    }
  }, [options, router])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || tableLoading) return

    const controller = new AbortController()
    moreController.current?.abort()
    moreController.current = controller
    setLoadingMore(true)

    try {
      const query = { limit: 50, sort: options.sort, order: options.order, cursor: nextCursor } satisfies FolderChildrenQuery
      const page = await apiJSON<NodePage>(`/api/v1/folders/${folder.id}/children`, { query, signal: controller.signal })

      if (controller.signal.aborted) return
      setNodes((current) => appendUnique(current, page.nodes))
      setNextCursor(page.nextCursor)
    } catch (error) {
      if (!controller.signal.aborted) handleBrowserError(error, router, "Could not load more files")
    } finally {
      if (moreController.current === controller) {
        moreController.current = null
        setLoadingMore(false)
      }
    }
  }, [folder.id, loadingMore, nextCursor, options, router, tableLoading])

  useEffect(() => {
    return () => {
      mainController.current?.abort()
      moreController.current?.abort()
    }
  }, [])

  useEffect(() => {
    function popstate() {
      const folderId = folderIdFromBrowserPath(window.location.pathname)
      if (folderId === null || folderId === folder.id) return
      void navigateFolder(folderId, "none")
    }

    window.addEventListener("popstate", popstate)
    return () => window.removeEventListener("popstate", popstate)
  }, [folder.id, navigateFolder])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !nextCursor || tableLoading) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void loadMore()
    }, { rootMargin: "240px" })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, nextCursor, tableLoading])

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined

    function completed(event: Event) {
      const detail = (event as CustomEvent<UploadCompletedDetail>).detail
      if (detail?.folderId !== folder.id) return
      if (timeout) clearTimeout(timeout)

      timeout = setTimeout(() => {
        void reloadChildren().catch((error) => handleBrowserError(error, router, "Upload completed, but the folder could not refresh"))
      }, 150)
    }

    window.addEventListener(UPLOAD_COMPLETED_EVENT, completed)
    return () => {
      if (timeout) clearTimeout(timeout)
      window.removeEventListener(UPLOAD_COMPLETED_EVENT, completed)
    }
  }, [folder.id, reloadChildren, router])

  useHotkeys("r", () => void reloadCurrent(), { enabled: browserShortcutsEnabled }, [browserShortcutsEnabled, reloadCurrent])
  useHotkeys(["ctrl+a", "meta+a"], () => selectAll(true), {
    enabled: browserShortcutsEnabled && nodes.length > 0,
    preventDefault: true,
  }, [browserShortcutsEnabled, nodes])
  useHotkeys("esc", clearSelection, {
    enabled: browserShortcutsEnabled && selectedNodes.length > 0,
  }, [browserShortcutsEnabled, selectedNodes.length])
  useHotkeys("delete", () => setTrashTargets([...selectedNodes]), {
    enabled: browserShortcutsEnabled && bulkCanTrash,
    preventDefault: true,
  }, [browserShortcutsEnabled, bulkCanTrash, selectedNodes])

  function updateOptions(patch: Partial<BrowserOptions>) {
    const next = { ...options, ...patch }
    const reload = next.sort !== options.sort || next.order !== options.order

    setOptions(next)
    window.history.replaceState(null, "", browserURL(window.location.pathname, next))

    if (reload) void reloadChildren(next).catch((error) => handleBrowserError(error, router, "Could not update folder"))
  }

  async function reloadCurrent() {
    try {
      await reloadChildren()
    } catch (error) {
      handleBrowserError(error, router, "Could not reload this folder")
    }
  }

  function select(nodeId: string, value: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (value) next.add(nodeId)
      else next.delete(nodeId)
      return next
    })
  }

  function selectAll(value: boolean) {
    setSelected(value ? new Set(nodes.map((node) => node.id)) : new Set())
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function removeNodes(nodeIds: readonly string[]) {
    const ids = new Set(nodeIds)
    setNodes((current) => current.filter((node) => !ids.has(node.id)))
    setSelected((current) => {
      const next = new Set(current)
      nodeIds.forEach((id) => next.delete(id))
      return next
    })
  }

  function moved(nodeId: string) {
    removeNodes([nodeId])
  }

  async function setFavorite(node: BrowserNode, favorite: boolean) {
    setNodes((current) => current.map((item) => item.id === node.id ? { ...item, isFavorite: favorite } : item))

    try {
      await apiJSON<Node>(`/api/v1/nodes/${node.id}/favorite`, { method: favorite ? "PUT" : "DELETE" })
    } catch (error) {
      setNodes((current) => current.map((item) => item.id === node.id ? { ...item, isFavorite: node.isFavorite } : item))
      handleBrowserError(error, router, favorite ? "Could not add to favorites" : "Could not remove from favorites")
    }
  }

  async function setNodesFavorite(source: readonly BrowserNode[], favorite: boolean) {
    const targets = source.filter((node) => node.canFavorite && node.isFavorite !== favorite)
    if (!targets.length || favoritePending) return

    setFavoritePending(true)
    const previous = new Map(targets.map((node) => [node.id, node.isFavorite]))
    setNodes((current) => current.map((node) => previous.has(node.id) ? { ...node, isFavorite: favorite } : node))
    const failures = new Set<string>()
    const errors: unknown[] = []

    for (let index = 0; index < targets.length; index += 8) {
      const batch = targets.slice(index, index + 8)
      const results = await Promise.allSettled(batch.map((node) => apiJSON<Node>(`/api/v1/nodes/${node.id}/favorite`, { method: favorite ? "PUT" : "DELETE" })))

      results.forEach((result, offset) => {
        if (result.status === "rejected") {
          failures.add(batch[offset].id)
          errors.push(result.reason)
        }
      })
    }

    if (failures.size) {
      setNodes((current) => current.map((node) => failures.has(node.id) ? { ...node, isFavorite: previous.get(node.id) ?? node.isFavorite } : node))

      if (errors.some((error) => error instanceof APIError && error.status === 401)) {
        router.replace("/login")
        router.refresh()
      } else {
        toast.error(`${failures.size} item${failures.size === 1 ? "" : "s"} could not be updated`)
      }
    } else {
      toast.success(favorite ? "Added to favorites" : "Removed from favorites")
    }

    setFavoritePending(false)
  }

  return (
    <FileUploadTarget folderId={folder.id} disabled={accessLevel === "view"}>
      <div
        className={cn(
          "mx-auto flex w-full max-w-7xl flex-col gap-5",
          horizontalToolbarDocked && selectedNodes.length === 0 && "pb-24",
          horizontalToolbarDocked && selectedNodes.length > 0 && "pb-40",
          !horizontalToolbarDocked && selectedNodes.length > 0 && "pb-28",
          rightToolbarDocked && "sm:pr-16",
        )}
      >
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {selectedNodes.length === 0
            ? "No items selected"
            : `${selectedNodes.length} item${selectedNodes.length === 1 ? "" : "s"} selected`}
        </p>

        <FileBrowserChrome
          folder={folder}
          breadcrumbs={breadcrumbs}
          accessLevel={accessLevel}
          options={options}
          itemCount={nodes.length}
          hasMore={!!nextCursor}
          reloading={tableLoading}
          toolbarConfig={toolbarConfig}
          selectionActive={selectedNodes.length > 0}
          onNavigate={(folderId) => void navigateFolder(folderId)}
          onReload={reloadCurrent}
          onOptionsChange={updateOptions}
        />

        {selectedNodes.length > 0 && (
          <div
            className={cn(
              "pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 transition-[bottom] duration-200 ease-out",
              mergeHorizontalDocks && "sm:bottom-[calc(4.75rem+env(safe-area-inset-bottom))]",
            )}
          >
            <div
              role="toolbar"
              aria-label={`${selectedNodes.length} selected item${selectedNodes.length === 1 ? "" : "s"} actions`}
              className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150"
            >
              <span className="whitespace-nowrap px-2 text-sm font-medium">
                {selectedNodes.length} selected
              </span>

              <div className="hidden h-5 w-px bg-border sm:block" />

              <div className="hidden items-center gap-1 sm:flex">
                {bulkCanMove && (
                  <Button size="sm" variant="ghost" disabled={favoritePending} onClick={() => setMoveTargets(selectedNodes)}>
                    <MoveIcon />
                    Move
                  </Button>
                )}

                {bulkCanFavorite && (
                  <Button size="sm" variant="ghost" disabled={favoritePending} onClick={() => void setNodesFavorite(selectedNodes, true)}>
                    {favoritePending ? <Loader2Icon className="animate-spin" /> : <StarIcon />}
                    Favorite
                  </Button>
                )}

                {bulkCanUnfavorite && (
                  <Button size="sm" variant="ghost" disabled={favoritePending} onClick={() => void setNodesFavorite(selectedNodes, false)}>
                    {favoritePending ? <Loader2Icon className="animate-spin" /> : <StarOffIcon />}
                    Unfavorite
                  </Button>
                )}

                {bulkCanTrash && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive focus-visible:text-destructive"
                    disabled={favoritePending}
                    onClick={() => setTrashTargets(selectedNodes)}
                  >
                    <Trash2Icon />
                    Trash
                  </Button>
                )}
              </div>

              {hasBulkActions && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="sm:hidden" disabled={favoritePending}>
                      <MoreHorizontalIcon />
                      Actions
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent align="end">
                    {bulkCanMove && (
                      <DropdownMenuItem onSelect={() => setMoveTargets(selectedNodes)}>
                        <MoveIcon />
                        Move
                      </DropdownMenuItem>
                    )}

                    {bulkCanFavorite && (
                      <DropdownMenuItem onSelect={() => void setNodesFavorite(selectedNodes, true)}>
                        <StarIcon />
                        Add to favorites
                      </DropdownMenuItem>
                    )}

                    {bulkCanUnfavorite && (
                      <DropdownMenuItem onSelect={() => void setNodesFavorite(selectedNodes, false)}>
                        <StarOffIcon />
                        Remove from favorites
                      </DropdownMenuItem>
                    )}

                    {bulkCanTrash && (
                      <>
                        {(bulkCanMove || bulkCanFavorite || bulkCanUnfavorite) && <DropdownMenuSeparator />}
                        <DropdownMenuItem variant="destructive" onSelect={() => setTrashTargets(selectedNodes)}>
                          <Trash2Icon />
                          Move to trash
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              <div className="h-5 w-px bg-border" />

              <Button
                size="icon-sm"
                variant="ghost"
                disabled={favoritePending}
                aria-label="Clear selection"
                title="Clear selection"
                onClick={clearSelection}
              >
                <XIcon />
              </Button>
            </div>
          </div>
        )}

        {moveTargets && (
          <MoveNodesDialog
            nodes={moveTargets}
            folder={folder}
            breadcrumbs={breadcrumbs}
            initialPage={currentPage}
            options={options}
            open
            onOpenChange={(open) => {
              if (!open) setMoveTargets(undefined)
            }}
            onMoved={removeNodes}
          />
        )}

        {trashTargets && (
          <TrashNodesDialog
            nodes={trashTargets}
            open
            onOpenChange={(open) => {
              if (!open) setTrashTargets(undefined)
            }}
            onTrashed={removeNodes}
          />
        )}

        <BrowserItems
          nodes={nodes}
          folder={folder}
          breadcrumbs={breadcrumbs}
          page={currentPage}
          options={options}
          selected={selected}
          loading={tableLoading}
          favoritePending={favoritePending}
          onNavigate={(folderId) => void navigateFolder(folderId)}
          onSelect={select}
          onSelectAll={selectAll}
          onMoveTargets={(targets) => setMoveTargets([...targets])}
          onTrashTargets={(targets) => setTrashTargets([...targets])}
          onFavoriteTargets={setNodesFavorite}
          onFavorite={setFavorite}
          onMoved={moved}
          onReload={reloadChildren}
        />

        {nextCursor && <div ref={sentinelRef} className="h-px" aria-hidden />}

        {loadingMore && (
          <div role="status" aria-live="polite" className="flex justify-center py-2 text-xs text-muted-foreground">
            <Loader2Icon className="mr-2 size-3.5 animate-spin" aria-hidden />
            Loading more items…
          </div>
        )}
      </div>
    </FileUploadTarget>
  )
}

async function loadChildren(folderId: string, options: BrowserOptions, signal: AbortSignal) {
  const query = { limit: 50, sort: options.sort, order: options.order } satisfies FolderChildrenQuery
  return apiJSON<NodePage>(`/api/v1/folders/${folderId}/children`, { query, signal })
}

function appendUnique(current: BrowserNode[], incoming: readonly BrowserNode[]) {
  const ids = new Set(current.map((node) => node.id))
  return [...current, ...incoming.filter((node) => !ids.has(node.id))]
}

function handleBrowserError(error: unknown, router: ReturnType<typeof useRouter>, fallback: string) {
  if (error instanceof APIError && error.status === 401) {
    router.replace("/login")
    router.refresh()
    return
  }

  toast.error(error instanceof APIError ? error.message : fallback)
}