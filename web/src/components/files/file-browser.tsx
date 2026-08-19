"use client"

import { Fragment, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ArrowDownIcon, ArrowUpIcon, FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FileTextIcon, FileVideoIcon, FolderIcon, FolderOpenIcon, LayoutGridIcon, ListIcon, Loader2Icon, StarIcon, StarOffIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { CreateFolderDialog, NodeActionsMenu } from "@/components/files/node-actions"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiJSON } from "@/lib/api/client"
import type { BrowserNode, FolderChildrenQuery, Node, NodePage } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"
import { browserURL, folderURL, type BrowserOptions, type BrowserSort } from "@/lib/files/browser"

type FileBrowserProps = {
  folder: Node
  breadcrumbs: readonly Node[]
  initialPage: NodePage
  options: BrowserOptions
}

type NodeViewProps = {
  nodes: BrowserNode[]
  folder: Node
  breadcrumbs: readonly Node[]
  page: NodePage
  options: BrowserOptions
  selected: ReadonlySet<string>
  onSelect: (nodeId: string, selected: boolean) => void
  onSelectAll: (selected: boolean) => void
  onFavorite: (node: BrowserNode, favorite: boolean) => Promise<void>
  onMoved: (nodeId: string) => void
  onReload: () => Promise<void>
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

export function FileBrowser({ folder, breadcrumbs, initialPage, options }: FileBrowserProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [nodes, setNodes] = useState<BrowserNode[]>(() => [...initialPage.nodes])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [loadingMore, setLoadingMore] = useState(false)
  const [bulkPending, setBulkPending] = useState(false)
  const selectedNodes = nodes.filter((node) => selected.has(node.id))
  const bulkCanFavorite = selectedNodes.length > 0 && selectedNodes.every((node) => node.canFavorite)
  const bulkFavorite = selectedNodes.length > 0 && !selectedNodes.every((node) => node.isFavorite)
  const currentPage: NodePage = { nodes, accessLevel: initialPage.accessLevel, ...(nextCursor ? { nextCursor } : {}) }

  function updateOptions(next: Partial<BrowserOptions>) {
    router.replace(browserURL(pathname, { ...options, ...next }), { scroll: false })
  }

  function changeSort(sort: BrowserSort) {
    updateOptions({ sort, order: sort === "name" ? "asc" : "desc" })
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

  async function reload() {
    const query = { limit: 50, sort: options.sort, order: options.order } satisfies FolderChildrenQuery
    const page = await apiJSON<NodePage>(`/api/v1/folders/${folder.id}/children`, { query })
    setNodes([...page.nodes])
    setNextCursor(page.nextCursor)
    setSelected(new Set())
  }

  async function setFavorite(node: BrowserNode, favorite: boolean) {
    setNodes((current) => current.map((item) => item.id === node.id ? { ...item, isFavorite: favorite } : item))

    try {
      await apiJSON<Node>(`/api/v1/nodes/${node.id}/favorite`, { method: favorite ? "PUT" : "DELETE" })
    } catch (error) {
      setNodes((current) => current.map((item) => item.id === node.id ? { ...item, isFavorite: node.isFavorite } : item))
      handleMutationError(error, favorite ? "Could not add to favorites" : "Could not remove from favorites")
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
      const unauthorized = errors.some((error) => error instanceof APIError && error.status === 401)
      if (unauthorized) {
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

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)

    try {
      const query = { limit: 50, sort: options.sort, order: options.order, cursor: nextCursor } satisfies FolderChildrenQuery
      const page = await apiJSON<NodePage>(`/api/v1/folders/${folder.id}/children`, { query })
      setNodes((current) => [...current, ...page.nodes])
      setNextCursor(page.nextCursor)
    } catch (error) {
      if (error instanceof APIError && error.status === 401) {
        router.replace("/login")
        router.refresh()
        return
      }
      if (error instanceof APIError && [403, 404, 409].includes(error.status)) {
        toast.error("This folder is no longer available")
        router.refresh()
        return
      }
      toast.error("Could not load more files")
    } finally {
      setLoadingMore(false)
    }
  }

  function handleMutationError(error: unknown, fallback: string) {
    if (error instanceof APIError && error.status === 401) {
      router.replace("/login")
      router.refresh()
      return
    }
    toast.error(error instanceof APIError ? error.message : fallback)
  }

  const viewProps: NodeViewProps = {
    nodes,
    folder,
    breadcrumbs,
    page: currentPage,
    options,
    selected,
    onSelect: select,
    onSelectAll: selectAll,
    onFavorite: setFavorite,
    onMoved: moved,
    onReload: reload,
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <BrowserBreadcrumbs items={breadcrumbs} options={options} />

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{folder.isRoot ? "Files" : folder.name}</h1>
          <p className="text-sm text-muted-foreground">{nodes.length}{nextCursor ? "+" : ""} items loaded</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {initialPage.accessLevel !== "view" && <CreateFolderDialog folder={folder} onReload={reload} />}
          <BrowserControls options={options} onChange={updateOptions} onSortChange={changeSort} />
        </div>
      </div>

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

      {nodes.length === 0 ? <EmptyFolder /> : options.view === "grid" ? <NodeGrid {...viewProps} /> : <NodeList {...viewProps} />}

      {nextCursor && (
        <div className="flex justify-center pt-1">
          <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore && <Loader2Icon className="animate-spin" />}
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  )
}

function BrowserBreadcrumbs({ items, options }: { items: readonly Node[]; options: BrowserOptions }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const current = index === items.length - 1
          return (
            <Fragment key={item.id}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {current ? (
                  <BreadcrumbPage>{item.isRoot ? "Files" : item.name}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={folderURL(item.id, options)}>{item.isRoot ? "Files" : item.name}</Link>
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

function BrowserControls({ options, onChange, onSortChange }: { options: BrowserOptions; onChange: (options: Partial<BrowserOptions>) => void; onSortChange: (sort: BrowserSort) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={options.sort} onValueChange={(value) => onSortChange(value as BrowserSort)}>
        <SelectTrigger size="sm" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="name">Name</SelectItem>
          <SelectItem value="updated">Modified</SelectItem>
          <SelectItem value="size">Size</SelectItem>
        </SelectContent>
      </Select>

      <Button variant="outline" size="icon-sm" aria-label={options.order === "asc" ? "Sort descending" : "Sort ascending"} onClick={() => onChange({ order: options.order === "asc" ? "desc" : "asc" })}>
        {options.order === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
      </Button>

      <div className="flex rounded-lg border p-0.5">
        <Button variant={options.view === "list" ? "secondary" : "ghost"} size="icon-sm" aria-label="List view" aria-pressed={options.view === "list"} onClick={() => onChange({ view: "list" })}>
          <ListIcon />
        </Button>
        <Button variant={options.view === "grid" ? "secondary" : "ghost"} size="icon-sm" aria-label="Grid view" aria-pressed={options.view === "grid"} onClick={() => onChange({ view: "grid" })}>
          <LayoutGridIcon />
        </Button>
      </div>
    </div>
  )
}

function NodeList(props: NodeViewProps) {
  const allSelected = props.nodes.length > 0 && props.nodes.every((node) => props.selected.has(node.id))
  const someSelected = props.nodes.some((node) => props.selected.has(node.id))

  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} aria-label="Select all loaded items" onCheckedChange={(value) => props.onSelectAll(value === true)} />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Type</TableHead>
            <TableHead className="hidden w-32 sm:table-cell">Size</TableHead>
            <TableHead className="hidden w-36 lg:table-cell">Modified</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.nodes.map((node) => (
            <TableRow key={node.id} data-state={props.selected.has(node.id) ? "selected" : undefined}>
              <TableCell>
                <Checkbox checked={props.selected.has(node.id)} aria-label={`Select ${node.name}`} onCheckedChange={(value) => props.onSelect(node.id, value === true)} />
              </TableCell>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <NodeIcon node={node} />
                  {node.kind === "folder" ? (
                    <Link className="truncate font-medium hover:underline" href={folderURL(node.id, props.options)}>{node.name}</Link>
                  ) : (
                    <span className="truncate font-medium">{node.name}</span>
                  )}
                  {node.isFavorite && <StarIcon className="size-3.5 shrink-0 fill-current text-muted-foreground" aria-label="Favorite" />}
                </div>
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{nodeType(node)}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">{node.kind === "file" && node.size != null ? formatBytes(node.size) : "—"}</TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell" title={node.updatedAt}>{formatDate(node.updatedAt)}</TableCell>
              <TableCell>
                <NodeActionsMenu node={node} folder={props.folder} breadcrumbs={props.breadcrumbs} page={props.page} options={props.options} onReload={props.onReload} onMoved={props.onMoved} onFavorite={props.onFavorite} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function NodeGrid(props: NodeViewProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {props.nodes.map((node) => (
        <div key={node.id} className="relative flex min-h-36 flex-col justify-between gap-4 rounded-xl border p-3 transition-colors data-[selected=true]:bg-muted/60" data-selected={props.selected.has(node.id)}>
          <div className="flex items-start justify-between gap-2">
            <Checkbox checked={props.selected.has(node.id)} aria-label={`Select ${node.name}`} onCheckedChange={(value) => props.onSelect(node.id, value === true)} />
            <NodeActionsMenu node={node} folder={props.folder} breadcrumbs={props.breadcrumbs} page={props.page} options={props.options} onReload={props.onReload} onMoved={props.onMoved} onFavorite={props.onFavorite} />
          </div>

          <div className="grid size-10 place-items-center rounded-lg bg-muted">
            <NodeIcon node={node} className="size-5" />
          </div>

          <div className="min-w-0">
            {node.kind === "folder" ? (
              <Link className="block truncate text-sm font-medium hover:underline" href={folderURL(node.id, props.options)}>{node.name}</Link>
            ) : (
              <div className="truncate text-sm font-medium">{node.name}</div>
            )}
            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <span className="truncate">{node.kind === "file" && node.size != null ? `${nodeType(node)} · ${formatBytes(node.size)}` : nodeType(node)}</span>
              {node.isFavorite && <StarIcon className="size-3 shrink-0 fill-current" aria-label="Favorite" />}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function NodeIcon({ node, className = "size-4 shrink-0" }: { node: BrowserNode; className?: string }) {
  if (node.kind === "folder") return <FolderIcon className={className} />

  switch (node.category) {
    case "image":
      return <FileImageIcon className={className} />
    case "video":
      return <FileVideoIcon className={className} />
    case "audio":
      return <FileAudioIcon className={className} />
    case "document":
    case "text":
      return <FileTextIcon className={className} />
    case "archive":
      return <FileArchiveIcon className={className} />
    default:
      return <FileIcon className={className} />
  }
}

function EmptyFolder() {
  return (
    <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div className="space-y-3">
        <FolderOpenIcon className="mx-auto size-10 text-muted-foreground" />
        <div>
          <p className="font-medium">This folder is empty</p>
          <p className="text-sm text-muted-foreground">Create a folder or upload files here.</p>
        </div>
      </div>
    </div>
  )
}

function nodeType(node: BrowserNode) {
  if (node.kind === "folder") return "Folder"
  if (node.category) return node.category.charAt(0).toUpperCase() + node.category.slice(1)
  return node.mimeType || "File"
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${numberFormatter.format(bytes / 1024 ** exponent)} ${units[exponent]}`
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value))
}