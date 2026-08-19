"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, StarIcon, StarOffIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { FileBrowserChrome } from "@/components/files/file-browser-chrome"
import { BrowserItems } from "@/components/files/file-browser-items"
import { UPLOAD_COMPLETED_EVENT, type UploadCompletedDetail } from "@/components/uploads/upload-provider"
import { FileUploadTarget } from "@/components/uploads/upload-target"
import { Button } from "@/components/ui/button"
import { apiJSON } from "@/lib/api/client"
import type { Breadcrumbs, BrowserNode, CurrentUserRoot, FolderChildrenQuery, Node, NodePage } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { browserURL, type BrowserOptions } from "@/lib/files/browser"
import { folderBrowserPath, folderIdFromBrowserPath } from "@/lib/files/navigation"

type FileBrowserProps = {
  folder: Node
  breadcrumbs: readonly Node[]
  initialPage: NodePage
  options: BrowserOptions
}

type HistoryMode = "push" | "replace" | "none"

export function FileBrowser({ folder: initialFolder, breadcrumbs: initialBreadcrumbs, initialPage, options: initialOptions }: FileBrowserProps) {
  const router = useRouter()
  const [folder, setFolder] = useState(initialFolder)
  const [breadcrumbs, setBreadcrumbs] = useState<readonly Node[]>(initialBreadcrumbs)
  const [nodes, setNodes] = useState<BrowserNode[]>(() => [...initialPage.nodes])
  const [accessLevel, setAccessLevel] = useState(initialPage.accessLevel)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [options, setOptions] = useState(initialOptions)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [tableLoading, setTableLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [bulkPending, setBulkPending] = useState(false)
  const mainController = useRef<AbortController | null>(null)
  const moreController = useRef<AbortController | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const selectedNodes = nodes.filter((node) => selected.has(node.id))
  const bulkCanFavorite = selectedNodes.length > 0 && selectedNodes.every((node) => node.canFavorite)
  const bulkFavorite = selectedNodes.length > 0 && !selectedNodes.every((node) => node.isFavorite)
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
      if (folderId === null) return
      if (folderId === folder.id) return
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

  function updateOptions(patch: Partial<BrowserOptions>) {
    const next = { ...options, ...patch }
    const reload = next.sort !== options.sort || next.order !== options.order

    setOptions(next)
    window.history.replaceState(null, "", browserURL(window.location.pathname, next))

    if (reload) {
      void reloadChildren(next).catch((error) => handleBrowserError(error, router, "Could not update folder"))
    }
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

  function moved(nodeId: string) {
    setNodes((current) => current.filter((node) => node.id !== nodeId))
    setSelected((current) => {
      const next = new Set(current)
      next.delete(nodeId)
      return next
    })
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

  async function setSelectedFavorite(favorite: boolean) {
    const targets = selectedNodes.filter((node) => node.canFavorite)
    if (!targets.length || bulkPending) return

    setBulkPending(true)
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

    setBulkPending(false)
  }

  return (
    <FileUploadTarget folderId={folder.id} disabled={accessLevel === "view"}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <FileBrowserChrome
          folder={folder}
          breadcrumbs={breadcrumbs}
          accessLevel={accessLevel}
          options={options}
          itemCount={nodes.length}
          hasMore={!!nextCursor}
          reloading={tableLoading}
          onNavigate={(folderId) => void navigateFolder(folderId)}
          onReload={reloadCurrent}
          onOptionsChange={updateOptions}
        />

        {selectedNodes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            <span className="mr-auto text-sm font-medium">{selectedNodes.length} selected</span>
            {bulkCanFavorite && (
              <Button size="sm" variant="outline" disabled={bulkPending} onClick={() => void setSelectedFavorite(bulkFavorite)}>
                {bulkPending ? <Loader2Icon className="animate-spin" /> : bulkFavorite ? <StarIcon /> : <StarOffIcon />}
                {bulkFavorite ? "Favorite" : "Unfavorite"}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={bulkPending} onClick={() => setSelected(new Set())}>
              <XIcon />
              Clear
            </Button>
          </div>
        )}

        <BrowserItems
          nodes={nodes}
          folder={folder}
          breadcrumbs={breadcrumbs}
          page={currentPage}
          options={options}
          selected={selected}
          loading={tableLoading}
          onNavigate={(folderId) => void navigateFolder(folderId)}
          onSelect={select}
          onSelectAll={selectAll}
          onFavorite={setFavorite}
          onMoved={moved}
          onReload={reloadChildren}
        />

        {nextCursor && <div ref={sentinelRef} className="h-px" aria-hidden />}
        {loadingMore && (
          <div className="flex justify-center py-2 text-xs text-muted-foreground">
            <Loader2Icon className="mr-2 size-3.5 animate-spin" />
            Loading more…
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