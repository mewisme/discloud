"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { useWorkspace } from "@/components/app/workspace-context"
import { UPLOAD_COMPLETED_EVENT, type UploadCompletedDetail } from "@/components/uploads/upload-provider"
import { apiJSON } from "@/lib/api/client"
import type { Breadcrumbs, BrowserNode, FolderChildrenQuery, Node, NodePage } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { type BrowserOptions, browserURL } from "@/lib/files/browser"
import { folderBrowserPath, folderIdFromBrowserPath } from "@/lib/files/navigation"

type HistoryMode = "push" | "replace" | "none"

export function useFileBrowserController({
  initialFolder,
  initialBreadcrumbs,
  initialPage,
  initialOptions,
}: {
  initialFolder: Node
  initialBreadcrumbs: readonly Node[]
  initialPage: NodePage
  initialOptions: BrowserOptions
}) {
  const router = useRouter()
  const workspace = useWorkspace()
  const [folder, setFolder] = useState(initialFolder)
  const [breadcrumbs, setBreadcrumbs] = useState<readonly Node[]>(initialBreadcrumbs)
  const [nodes, setNodes] = useState<BrowserNode[]>(() => [...initialPage.nodes])
  const [accessLevel, setAccessLevel] = useState(initialPage.accessLevel)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [options, setOptions] = useState(initialOptions)
  const [tableLoading, setTableLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [resetVersion, setResetVersion] = useState(0)
  const mainController = useRef<AbortController | null>(null)
  const moreController = useRef<AbortController | null>(null)

  const currentPage: NodePage = {
    nodes,
    accessLevel,
    ...(nextCursor ? { nextCursor } : {}),
  }

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
      setResetVersion((current) => current + 1)
    } finally {
      if (mainController.current === controller) {
        mainController.current = null
        setTableLoading(false)
      }
    }
  }, [folder.id, options])

  const navigateFolder = useCallback(async (
    targetFolderId: string | undefined,
    historyMode: HistoryMode = "push",
  ) => {
    mainController.current?.abort()
    moreController.current?.abort()

    const controller = new AbortController()
    mainController.current = controller
    setTableLoading(true)

    try {
      let folderId = targetFolderId

      if (!folderId) {
        const root = breadcrumbs[0]
        if (!root?.isRoot) throw new Error("Workspace root is missing")
        folderId = root.id
      }

      const query = {
        limit: 50,
        sort: options.sort,
        order: options.order,
      } satisfies FolderChildrenQuery

      const [trail, page] = await Promise.all([
        apiJSON<Breadcrumbs>(`/api/v1/folders/${folderId}/breadcrumbs`, {
          signal: controller.signal,
        }),
        apiJSON<NodePage>(`/api/v1/folders/${folderId}/children`, {
          query,
          signal: controller.signal,
        }),
      ])

      if (controller.signal.aborted) return

      const nextFolder = trail.breadcrumbs.at(-1)
      if (!nextFolder) throw new Error("Folder breadcrumbs are empty")

      setFolder(nextFolder)
      setBreadcrumbs([...trail.breadcrumbs])
      setNodes([...page.nodes])
      setAccessLevel(page.accessLevel)
      setNextCursor(page.nextCursor)
      setResetVersion((current) => current + 1)

      if (historyMode !== "none") {
        const url = browserURL(
          folderBrowserPath(
            workspace.username,
            nextFolder.isRoot ? undefined : nextFolder.id,
          ),
          options,
        )

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
  }, [breadcrumbs, options, router, workspace.username])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || tableLoading) return

    const controller = new AbortController()
    moreController.current?.abort()
    moreController.current = controller
    setLoadingMore(true)

    try {
      const query = {
        limit: 50,
        sort: options.sort,
        order: options.order,
        cursor: nextCursor,
      } satisfies FolderChildrenQuery

      const page = await apiJSON<NodePage>(
        `/api/v1/folders/${folder.id}/children`,
        { query, signal: controller.signal },
      )

      if (controller.signal.aborted) return

      setNodes((current) => appendUnique(current, page.nodes))
      setNextCursor(page.nextCursor)
    } catch (error) {
      if (!controller.signal.aborted) {
        handleBrowserError(error, router, "Could not load more files")
        throw error
      }
    } finally {
      if (moreController.current === controller) {
        moreController.current = null
        setLoadingMore(false)
      }
    }
  }, [folder.id, loadingMore, nextCursor, options, router, tableLoading])

  const reloadCurrent = useCallback(async () => {
    try {
      await reloadChildren()
    } catch (error) {
      handleBrowserError(error, router, "Could not reload this folder")
    }
  }, [reloadChildren, router])

  const updateOptions = useCallback((patch: Partial<BrowserOptions>) => {
    const next = { ...options, ...patch }
    const reload = next.sort !== options.sort || next.order !== options.order

    setOptions(next)
    window.history.replaceState(null, "", browserURL(window.location.pathname, next))

    if (reload) {
      void reloadChildren(next).catch((error) => {
        handleBrowserError(error, router, "Could not update folder")
      })
    }
  }, [options, reloadChildren, router])

  const removeNodes = useCallback((nodeIds: readonly string[]) => {
    const ids = new Set(nodeIds)
    setNodes((current) => current.filter((node) => !ids.has(node.id)))
  }, [])

  const updateNodes = useCallback((
    updater: (nodes: BrowserNode[]) => BrowserNode[],
  ) => {
    setNodes((current) => updater(current))
  }, [])

  useEffect(() => {
    return () => {
      mainController.current?.abort()
      moreController.current?.abort()
    }
  }, [])

  useEffect(() => {
    function popstate() {
      const folderId = folderIdFromBrowserPath(
        window.location.pathname,
        workspace.username,
      )

      if (folderId === null || folderId === folder.id) return
      void navigateFolder(folderId, "none")
    }

    window.addEventListener("popstate", popstate)
    return () => window.removeEventListener("popstate", popstate)
  }, [folder.id, navigateFolder, workspace.username])

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined

    function completed(event: Event) {
      const detail = (event as CustomEvent<UploadCompletedDetail>).detail
      if (detail?.folderId !== folder.id) return

      if (timeout) clearTimeout(timeout)

      timeout = setTimeout(() => {
        void reloadChildren().catch((error) => {
          handleBrowserError(
            error,
            router,
            "Upload completed, but the folder could not refresh",
          )
        })
      }, 150)
    }

    window.addEventListener(UPLOAD_COMPLETED_EVENT, completed)

    return () => {
      if (timeout) clearTimeout(timeout)
      window.removeEventListener(UPLOAD_COMPLETED_EVENT, completed)
    }
  }, [folder.id, reloadChildren, router])

  return {
    folder,
    breadcrumbs,
    nodes,
    accessLevel,
    nextCursor,
    options,
    currentPage,
    tableLoading,
    loadingMore,
    resetVersion,
    loadMore,
    navigateFolder,
    reloadChildren,
    reloadCurrent,
    updateOptions,
    removeNodes,
    updateNodes,
  }
}

async function loadChildren(
  folderId: string,
  options: BrowserOptions,
  signal: AbortSignal,
) {
  const query = {
    limit: 50,
    sort: options.sort,
    order: options.order,
  } satisfies FolderChildrenQuery

  return apiJSON<NodePage>(
    `/api/v1/folders/${folderId}/children`,
    { query, signal },
  )
}

function appendUnique(
  current: BrowserNode[],
  incoming: readonly BrowserNode[],
) {
  const ids = new Set(current.map((node) => node.id))

  return [
    ...current,
    ...incoming.filter((node) => {
      if (ids.has(node.id)) return false
      ids.add(node.id)
      return true
    }),
  ]
}

function handleBrowserError(
  error: unknown,
  router: ReturnType<typeof useRouter>,
  fallback: string,
) {
  if (error instanceof APIError && error.status === 401) {
    router.replace("/login")
    router.refresh()
    return
  }

  toast.error(error instanceof APIError ? error.message : fallback)
}