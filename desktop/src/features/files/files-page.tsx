import type { NodePage } from "@discloud/api/models"
import { InlineFileBrowserControls } from "@discloud/app-ui/files/file-browser-controls"
import { FileBrowserHeader } from "@discloud/app-ui/files/file-browser-header"
import { FileBrowserItems } from "@discloud/app-ui/files/file-browser-items"
import { type BrowserOptions, browserSearchParams, type BrowserSort, browserURL, parseBrowserOptions } from "@discloud/shared/file-browser"
import { workspaceFilePath, workspaceFolderPath, workspacePath } from "@discloud/shared/navigation"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { LoaderCircleIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"

import { errorMessage } from "#lib/instance"

import { type DesktopFileBrowserData, loadDesktopFileBrowser, loadFolderChildren } from "./api"

type BrowserState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: DesktopFileBrowserData }

export function DesktopFilesPage() {
  const { username, folderId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, setState] = useState<BrowserState>({ status: "loading" })
  const [reloadVersion, setReloadVersion] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [paginationError, setPaginationError] = useState<string>()
  const options = parseBrowserOptions(Object.fromEntries(searchParams))
  const { sort, order } = options

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

  function updateOptions(patch: Partial<BrowserOptions>) {
    setSearchParams(browserSearchParams({ ...options, ...patch }), { replace: true })
  }

  function changeSort(nextSort: BrowserSort) {
    updateOptions({ sort: nextSort, order: nextSort === "name" ? "asc" : "desc" })
  }

  function folderPath(folderId: string, isRoot?: boolean) {
    if (!username) return "/"
    return isRoot ? workspacePath(username) : workspaceFolderPath(username, folderId)
  }

  function navigateFolder(folderId: string, isRoot?: boolean) {
    navigate(browserURL(folderPath(folderId, isRoot), options))
  }

  async function loadMore() {
    if (state.status !== "ready" || loadingMore || !state.data.page.nextCursor) return

    setLoadingMore(true)
    setPaginationError(undefined)
    const currentFolderId = state.data.folder.id

    try {
      const page = await loadFolderChildren(currentFolderId, { sort, order }, state.data.page.nextCursor)
      setState((current) => {
        if (current.status !== "ready" || current.data.folder.id !== currentFolderId) return current
        return { status: "ready", data: { ...current.data, page: mergePages(current.data.page, page) } }
      })
    } catch (error) {
      setPaginationError(errorMessage(error))
    } finally {
      setLoadingMore(false)
    }
  }

  if (state.status === "loading") return <FilesLoading />
  if (state.status === "error") return <FilesError message={state.message} onRetry={() => setReloadVersion((value) => value + 1)} />

  const { data } = state
  const workspaceUsername = data.workspace.owner.username
  const breadcrumbItems = data.breadcrumbs.map((item) => ({
    id: item.id,
    label: item.isRoot ? `${data.workspace.owner.name}'s workspace` : item.name,
    href: hashPath(browserURL(item.isRoot ? workspacePath(workspaceUsername) : workspaceFolderPath(workspaceUsername, item.id), options)),
    isRoot: item.isRoot,
  }))

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <FileBrowserHeader
        folder={data.folder}
        breadcrumbs={breadcrumbItems}
        itemCount={data.page.nodes.length}
        hasMore={!!data.page.nextCursor}
        onNavigate={(item) => navigateFolder(item.id, item.isRoot)}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="outline">Read only</Badge>
            <Badge variant="secondary">{data.page.accessLevel}</Badge>

            <Button type="button" size="icon-sm" variant="outline" aria-label="Reload folder" onClick={() => setReloadVersion((value) => value + 1)}>
              <RefreshCwIcon />
            </Button>

            <InlineFileBrowserControls options={options} onChange={updateOptions} onSortChange={changeSort} />
          </div>
        }
      />

      {paginationError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not load more items</AlertTitle>
          <AlertDescription>{paginationError}</AlertDescription>
        </Alert>
      ) : null}

      <FileBrowserItems
        nodes={data.page.nodes}
        folder={data.folder}
        breadcrumbs={data.breadcrumbs}
        view={options.view}
        folderHref={(id, isRoot) => hashPath(browserURL(isRoot ? workspacePath(workspaceUsername) : workspaceFolderPath(workspaceUsername, id), options))}
        fileHref={(id) => hashPath(workspaceFilePath(workspaceUsername, id))}
        onNavigateFolder={navigateFolder}
        onOpenFile={(id) => navigate(workspaceFilePath(workspaceUsername, id))}
        emptyDescription="No files or folders here."
      />

      {data.page.nextCursor ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? <LoaderCircleIcon className="animate-spin" /> : null}
            {loadingMore ? "Loading" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function FilesLoading() {
  return (
    <div className="grid min-h-64 place-items-center">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        Loading files
      </div>
    </div>
  )
}

function FilesError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Could not load files</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{message}</span>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>Try again</Button>
      </AlertDescription>
    </Alert>
  )
}

function mergePages(current: NodePage, next: NodePage): NodePage {
  const ids = new Set(current.nodes.map((node) => node.id))
  return { ...next, nodes: [...current.nodes, ...next.nodes.filter((node) => !ids.has(node.id))] }
}

function hashPath(path: string) {
  return `#${path}`
}