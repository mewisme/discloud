import type { BrowserNode, Node, NodePage } from "@discloud/api/models"
import { FileBrowserHeader } from "@discloud/app-ui/files/file-browser-header"
import { FileBrowserItems } from "@discloud/app-ui/files/file-browser-items"
import { type BrowserOptions, browserSearchParams, type BrowserSort, browserURL, parseBrowserOptions } from "@discloud/shared/file-browser"
import { workspaceFilePath, workspaceFolderPath, workspacePath } from "@discloud/shared/navigation"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Button } from "@discloud/ui/components/button"
import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { useDesktopUserConfig } from "../settings/ui/user-config-provider"
import { UPLOAD_COMPLETED_EVENT, type UploadCompletedDetail } from "../uploads/ui/upload-provider"
import { DesktopFileUploadTarget } from "../uploads/ui/upload-target"
import { contextMenuTargets } from "./actions/context-menu-targets"
import { DesktopMoveNodesDialog } from "./actions/move-nodes-dialog"
import { DesktopNodeActionsMenu, DesktopNodeContextMenu } from "./actions/node-actions-menu"
import { DesktopFileSelectionToolbar } from "./actions/selection-toolbar"
import { DesktopTrashNodesDialog } from "./actions/trash-nodes-dialog"
import { type DesktopFileBrowserData, loadDesktopFileBrowser, loadFolderChildren } from "./api"
import { DesktopFileBrowserToolbar } from "./browser/file-browser-toolbar"
import { downloadNativeFile } from "./native"

type BrowserState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: DesktopFileBrowserData }

export function DesktopFilesPage() {
  const { username, folderId } = useParams()
  const navigate = useNavigate()
  const { config } = useDesktopUserConfig()
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, setState] = useState<BrowserState>({ status: "loading" })
  const [reloadVersion, setReloadVersion] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [paginationError, setPaginationError] = useState<string>()
  const [uploadError, setUploadError] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [moveTargets, setMoveTargets] = useState<BrowserNode[]>()
  const [trashTargets, setTrashTargets] = useState<BrowserNode[]>()
  const [favoritePending, setFavoritePending] = useState(false)
  const options = parseBrowserOptions(Object.fromEntries(searchParams))
  const { sort, order } = options
  const toolbarConfig = config?.common.fileBrowserToolbar ?? { variant: "inline", dockPosition: "bottom" } as const
  const paginationMode = config?.common.pagination.mode ?? "manual"
  const currentFolderId = state.status === "ready" ? state.data.folder.id : undefined
  const nodes = state.status === "ready" ? state.data.page.nodes : []
  const selectedNodes = useMemo(() => nodes.filter((node) => selected.has(node.id)), [nodes, selected])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!username) {
        setState({ status: "error", message: "Workspace username is missing." })
        return
      }
      setState({ status: "loading" })
      setPaginationError(undefined)
      try {
        const data = await loadDesktopFileBrowser(username, folderId, { sort, order })
        if (!cancelled) setState({ status: "ready", data })
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [username, folderId, reloadVersion, sort, order])

  useEffect(() => {
    setSelected(new Set())
  }, [folderId, sort, order])

  useEffect(() => {
    const valid = new Set(nodes.map((node) => node.id))
    setSelected((current) => {
      const next = new Set([...current].filter((id) => valid.has(id)))
      return next.size === current.size ? current : next
    })
  }, [nodes])

  useEffect(() => {
    if (!currentFolderId) return
    let reloadTimer: ReturnType<typeof setTimeout> | undefined
    function uploaded(event: Event) {
      const detail = (event as CustomEvent<UploadCompletedDetail>).detail
      if (detail?.folderId !== currentFolderId) return
      if (reloadTimer) clearTimeout(reloadTimer)
      reloadTimer = setTimeout(() => {
        reloadTimer = undefined
        reload()
      }, 200)
    }
    window.addEventListener(UPLOAD_COMPLETED_EVENT, uploaded)
    return () => {
      window.removeEventListener(UPLOAD_COMPLETED_EVENT, uploaded)
      if (reloadTimer) clearTimeout(reloadTimer)
    }
  }, [currentFolderId])

  function reload() {
    setReloadVersion((value) => value + 1)
  }

  function changed() {
    setSelected(new Set())
    reload()
  }

  function updateOptions(patch: Partial<BrowserOptions>) {
    setSearchParams(browserSearchParams({ ...options, ...patch }), { replace: true })
  }

  function changeSort(nextSort: BrowserSort) {
    updateOptions({ sort: nextSort, order: nextSort === "name" ? "asc" : "desc" })
  }

  function folderPath(targetFolderId: string, isRoot?: boolean) {
    if (!username) return "/"
    const routeRootId = state.status === "ready" ? state.data.workspace.root.id : undefined
    return isRoot && targetFolderId === routeRootId ? workspacePath(username) : workspaceFolderPath(username, targetFolderId)
  }

  function navigateFolder(targetFolderId: string, isRoot?: boolean) {
    navigate(browserURL(folderPath(targetFolderId, isRoot), options))
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

  async function setFavorite(node: BrowserNode, favorite: boolean) {
    await setFavorites([node], favorite)
  }

  async function setFavorites(targets: readonly BrowserNode[], favorite: boolean) {
    const candidates = targets.filter((node) => node.canFavorite && node.isFavorite !== favorite)
    if (!candidates.length || favoritePending) return
    setFavoritePending(true)
    setActionError(undefined)
    const results = await Promise.allSettled(candidates.map((node) => apiJSON<Node>(`/api/v1/nodes/${encodeURIComponent(node.id)}/favorite`, { method: favorite ? "PUT" : "DELETE" })))
    const failed = results.filter((result) => result.status === "rejected")
    if (failed.length) setActionError(failed.length === 1 ? errorMessage((failed[0] as PromiseRejectedResult).reason) : `${failed.length} items could not be updated.`)
    setFavoritePending(false)
    reload()
  }

  function open(node: BrowserNode) {
    if (node.kind === "folder") navigateFolder(node.id, node.isRoot)
    else navigate(workspaceFilePath(workspaceUsername, node.id))
  }

  async function download(node: BrowserNode) {
    if (node.kind !== "file") return
    setActionError(undefined)
    try {
      await downloadNativeFile(node)
    } catch (cause) {
      setActionError(errorMessage(cause))
    }
  }

  async function loadMore() {
    if (state.status !== "ready" || loadingMore || !state.data.page.nextCursor) return
    setLoadingMore(true)
    setPaginationError(undefined)
    const targetFolderId = state.data.folder.id
    try {
      const page = await loadFolderChildren(targetFolderId, { sort, order }, state.data.page.nextCursor)
      setState((current) => {
        if (current.status !== "ready" || current.data.folder.id !== targetFolderId) return current
        return { status: "ready", data: { ...current.data, page: mergePages(current.data.page, page) } }
      })
    } catch (error) {
      setPaginationError(errorMessage(error))
    } finally {
      setLoadingMore(false)
    }
  }

  if (state.status === "loading") return <FilesLoading />
  if (state.status === "error") return <FilesError message={state.message} onRetry={reload} />

  const { data } = state
  const workspaceUsername = data.workspace.owner.username
  const editable = data.page.accessLevel !== "view"
  const shareable = data.page.accessLevel === "full"
  const bulkEditable = selectedNodes.length > 0 && selectedNodes.every((node) => node.accessLevel !== "view")
  const bulkSameOwner = selectedNodes.length > 0 && selectedNodes.every((node) => node.ownerUserId === selectedNodes[0].ownerUserId)
  const bulkCanMove = bulkEditable && bulkSameOwner
  const bulkCanTrash = bulkEditable
  const bulkCanFavorite = selectedNodes.some((node) => node.canFavorite && !node.isFavorite)
  const bulkCanUnfavorite = selectedNodes.some((node) => node.canFavorite && node.isFavorite)
  const horizontalToolbarDocked = toolbarConfig.variant === "dock" && toolbarConfig.dockPosition === "bottom"
  const rightToolbarDocked = toolbarConfig.variant === "dock" && toolbarConfig.dockPosition === "right"
  const selectionDocked = selectedNodes.length > 0
  const browserClassName = `mx-auto flex w-full max-w-7xl flex-col gap-5${horizontalToolbarDocked && selectionDocked ? " pb-40" : horizontalToolbarDocked ? " pb-24" : selectionDocked ? " pb-28" : ""}${rightToolbarDocked ? " sm:pr-16" : ""}`
  const breadcrumbItems = data.breadcrumbs.map((item) => {
    const routeRoot = item.id === data.workspace.root.id
    return { id: item.id, label: routeRoot ? `${data.workspace.owner.name}'s workspace` : item.name || "Shared folder", href: hashPath(browserURL(routeRoot ? workspacePath(workspaceUsername) : workspaceFolderPath(workspaceUsername, item.id), options)), isRoot: item.isRoot }
  })

  return (
    <DesktopFileUploadTarget folderId={data.folder.id} disabled={!editable} onError={setUploadError}>
      <div className={browserClassName}>
        <FileBrowserHeader
          folder={data.folder}
          breadcrumbs={breadcrumbItems}
          itemCount={data.page.nodes.length}
          hasMore={!!data.page.nextCursor}
          onNavigate={(item) => navigateFolder(item.id, item.isRoot)}
          actions={<DesktopFileBrowserToolbar folder={data.folder} options={options} editable={editable} shareable={shareable} reloading={false} toolbarConfig={toolbarConfig} selectionActive={selectedNodes.length > 0} onReload={reload} onCreated={changed} onOptionsChange={updateOptions} onSortChange={changeSort} />}
        />

        <DesktopFileSelectionToolbar count={selectedNodes.length} canMove={bulkCanMove} canTrash={bulkCanTrash} canFavorite={bulkCanFavorite} canUnfavorite={bulkCanUnfavorite} favoritePending={favoritePending} onMove={() => setMoveTargets([...selectedNodes])} onTrash={() => setTrashTargets([...selectedNodes])} onFavorite={() => void setFavorites(selectedNodes, true)} onUnfavorite={() => void setFavorites(selectedNodes, false)} onClear={() => setSelected(new Set())} />

        {uploadError ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Could not prepare upload</AlertTitle><AlertDescription>{uploadError}</AlertDescription></Alert> : null}
        {actionError ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Action failed</AlertTitle><AlertDescription>{actionError}</AlertDescription></Alert> : null}
        {paginationError ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Could not load more items</AlertTitle><AlertDescription>{paginationError}</AlertDescription></Alert> : null}

        <FileBrowserItems
          nodes={data.page.nodes}
          folder={data.folder}
          breadcrumbs={data.breadcrumbs}
          view={options.view}
          selection={{ selected, onSelect: select, onSelectAll: selectAll }}
          folderHref={(id, isRoot) => hashPath(browserURL(isRoot ? workspacePath(workspaceUsername) : workspaceFolderPath(workspaceUsername, id), options))}
          fileHref={(id) => hashPath(workspaceFilePath(workspaceUsername, id))}
          onNavigateFolder={navigateFolder}
          onOpenFile={(id) => navigate(workspaceFilePath(workspaceUsername, id))}
          renderNodeActions={(node) => <DesktopNodeActionsMenu node={node} folder={data.folder} breadcrumbs={data.breadcrumbs} page={data.page} favoritePending={favoritePending} onReload={changed} onFavorite={setFavorite} onOpen={open} onDownload={download} />}
          wrapNode={(node, children) => <DesktopNodeContextMenu node={node} targets={contextMenuTargets(node, selected, selectedNodes)} favoritePending={favoritePending} onReload={changed} onOpen={(target) => target.kind === "folder" ? navigateFolder(target.id, target.isRoot) : navigate(workspaceFilePath(workspaceUsername, target.id))} onDownload={download} onMove={(targets) => setMoveTargets([...targets])} onTrash={(targets) => setTrashTargets([...targets])} onFavoriteMany={setFavorites}>{children}</DesktopNodeContextMenu>}
          emptyDescription={editable ? "Drop files or folders here, or use Upload." : "No files or folders here."}
        />

        {data.page.nextCursor && paginationMode === "manual" ? <div className="flex justify-center"><Button type="button" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}{loadingMore ? "Loading" : "Load more"}</Button></div> : null}
        {data.page.nextCursor && paginationMode === "infinite" ? <InfiniteLoadMore loading={loadingMore} onVisible={() => void loadMore()} /> : null}
        {moveTargets ? <DesktopMoveNodesDialog nodes={moveTargets} folder={data.folder} breadcrumbs={data.breadcrumbs} initialPage={data.page} open onOpenChange={(open) => { if (!open) setMoveTargets(undefined) }} onMoved={changed} /> : null}
        {trashTargets ? <DesktopTrashNodesDialog nodes={trashTargets} open onOpenChange={(open) => { if (!open) setTrashTargets(undefined) }} onTrashed={changed} /> : null}
      </div>
    </DesktopFileUploadTarget>
  )
}

function InfiniteLoadMore({ loading, onVisible }: { loading: boolean; onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = ref.current
    if (!target) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loading) onVisible()
    }, { rootMargin: "320px" })
    observer.observe(target)
    return () => observer.disconnect()
  }, [loading, onVisible])
  return <div ref={ref} className="flex min-h-12 items-center justify-center text-sm text-muted-foreground">{loading ? <><LoaderCircleIcon className="mr-2 size-4 animate-spin" />Loading more</> : "Scroll to load more"}</div>
}

function FilesLoading() {
  return <div className="grid min-h-64 place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" />Loading files</div></div>
}

function FilesError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Could not load files</AlertTitle><AlertDescription className="flex flex-col items-start gap-3"><span>{message}</span><Button type="button" size="sm" variant="outline" onClick={onRetry}>Try again</Button></AlertDescription></Alert>
}

function mergePages(current: NodePage, next: NodePage): NodePage {
  const ids = new Set(current.nodes.map((node) => node.id))
  return { ...next, nodes: [...current.nodes, ...next.nodes.filter((node) => !ids.has(node.id))] }
}

function hashPath(path: string) {
  return `#${path}`
}
