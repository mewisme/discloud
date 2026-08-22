import type { BrowserNode, Node, NodePage } from "@discloud/api/models"
import { formatBytes, formatDateTime } from "@discloud/shared/format"
import { workspaceFolderPath, workspacePath } from "@discloud/shared/navigation"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@discloud/ui/components/breadcrumb"
import { Button } from "@discloud/ui/components/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { FileIcon, FolderIcon, FolderOpenIcon, LoaderCircleIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { Fragment, useEffect, useState } from "react"
import { Link, useParams } from "react-router"

import { errorMessage } from "#lib/instance"

import { type DesktopFileBrowserData, loadDesktopFileBrowser, loadFolderChildren } from "./api"

type BrowserState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: DesktopFileBrowserData }

export function DesktopFilesPage() {
  const { username, folderId } = useParams()
  const [state, setState] = useState<BrowserState>({ status: "loading" })
  const [reloadVersion, setReloadVersion] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [paginationError, setPaginationError] = useState<string>()

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
        const data = await loadDesktopFileBrowser(username, folderId)
        if (!cancelled) setState({ status: "ready", data })
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) })
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [username, folderId, reloadVersion])

  async function loadMore() {
    if (state.status !== "ready" || loadingMore || !state.data.page.nextCursor) return

    setLoadingMore(true)
    setPaginationError(undefined)
    const folderId = state.data.folder.id

    try {
      const page = await loadFolderChildren(folderId, state.data.page.nextCursor)

      setState((current) => {
        if (current.status !== "ready" || current.data.folder.id !== folderId) return current
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

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{data.folder.isRoot ? "Files" : data.folder.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">@{data.workspace.owner.username} · {data.page.nodes.length} loaded</p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline">Read only</Badge>
          <Badge variant="secondary">{data.page.accessLevel}</Badge>
          <Button type="button" size="icon-sm" variant="outline" aria-label="Reload folder" onClick={() => setReloadVersion((value) => value + 1)}>
            <RefreshCwIcon />
          </Button>
        </div>
      </div>

      <FolderBreadcrumbs username={data.workspace.owner.username} breadcrumbs={data.breadcrumbs} />

      {paginationError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not load more items</AlertTitle>
          <AlertDescription>{paginationError}</AlertDescription>
        </Alert>
      ) : null}

      {data.page.nodes.length === 0 ? <EmptyFolder /> : <FilesTable username={data.workspace.owner.username} nodes={data.page.nodes} />}

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

function FolderBreadcrumbs({ username, breadcrumbs }: { username: string; breadcrumbs: readonly Node[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumbs.map((item, index) => {
          const last = index === breadcrumbs.length - 1
          const href = item.isRoot ? workspacePath(username) : workspaceFolderPath(username, item.id)

          return (
            <Fragment key={item.id}>
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem>
                {last ? (
                  <BreadcrumbPage>{item.isRoot ? "Files" : item.name}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={href}>{item.isRoot ? "Files" : item.name}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function FilesTable({ username, nodes }: { username: string; nodes: readonly BrowserNode[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead className="text-right">Modified</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {nodes.map((node) => <FileRow key={node.id} username={username} node={node} />)}
        </TableBody>
      </Table>
    </div>
  )
}

function FileRow({ username, node }: { username: string; node: BrowserNode }) {
  const folder = node.kind === "folder"

  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-52 items-center gap-2">
          {folder ? <FolderIcon className="size-4 shrink-0 text-muted-foreground" /> : <FileIcon className="size-4 shrink-0 text-muted-foreground" />}
          {folder ? <Link className="truncate font-medium hover:underline" to={workspaceFolderPath(username, node.id)}>{node.name}</Link> : <span className="truncate">{node.name}</span>}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{nodeType(node)}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{node.size == null ? "—" : formatBytes(node.size)}</TableCell>
      <TableCell className="text-right text-muted-foreground">{formatDateTime(node.updatedAt)}</TableCell>
    </TableRow>
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

function EmptyFolder() {
  return (
    <div className="grid min-h-64 place-items-center rounded-lg border border-dashed">
      <div className="flex flex-col items-center gap-2 text-center text-muted-foreground">
        <FolderOpenIcon className="size-8" />
        <div>
          <p className="text-sm font-medium text-foreground">This folder is empty</p>
          <p className="mt-1 text-xs">Upload and file mutations will be added in later desktop steps.</p>
        </div>
      </div>
    </div>
  )
}

function mergePages(current: NodePage, next: NodePage): NodePage {
  return { ...next, nodes: [...current.nodes, ...next.nodes] }
}

function nodeType(node: BrowserNode) {
  if (node.kind === "folder") return "Folder"
  if (node.mimeType) return node.mimeType
  if (node.extension) return node.extension.toUpperCase()
  return node.category || "File"
}