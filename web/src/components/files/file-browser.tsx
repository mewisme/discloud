"use client"

import { Fragment, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ArrowDownIcon, ArrowUpIcon, FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FileTextIcon, FileVideoIcon, FolderIcon, FolderOpenIcon, LayoutGridIcon, ListIcon, Loader2Icon, StarIcon } from "lucide-react"
import { toast } from "sonner"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
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

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

export function FileBrowser({ folder, breadcrumbs, initialPage, options }: FileBrowserProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [nodes, setNodes] = useState<BrowserNode[]>(() => [...initialPage.nodes])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [loadingMore, setLoadingMore] = useState(false)

  function updateOptions(next: Partial<BrowserOptions>) {
    router.replace(browserURL(pathname, { ...options, ...next }), { scroll: false })
  }

  function changeSort(sort: BrowserSort) {
    updateOptions({ sort, order: sort === "name" ? "asc" : "desc" })
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)

    try {
      const query = {
        limit: 50,
        sort: options.sort,
        order: options.order,
        cursor: nextCursor,
      } satisfies FolderChildrenQuery
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

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <BrowserBreadcrumbs items={breadcrumbs} options={options} />
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{folder.isRoot ? "Files" : folder.name}</h1>
          <p className="text-sm text-muted-foreground">{nodes.length}{nextCursor ? "+" : ""} items loaded</p>
        </div>
        <BrowserControls options={options} onChange={updateOptions} onSortChange={changeSort} />
      </div>

      {nodes.length === 0 ? (
        <EmptyFolder />
      ) : options.view === "grid" ? (
        <NodeGrid nodes={nodes} options={options} />
      ) : (
        <NodeList nodes={nodes} options={options} />
      )}

      {nextCursor && (
        <div className="flex justify-center pt-1">
          <Button variant="outline" disabled={loadingMore} onClick={loadMore}>
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

function BrowserControls({
  options,
  onChange,
  onSortChange,
}: {
  options: BrowserOptions
  onChange: (options: Partial<BrowserOptions>) => void
  onSortChange: (sort: BrowserSort) => void
}) {
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

      <Button
        variant="outline"
        size="icon-sm"
        aria-label={options.order === "asc" ? "Sort descending" : "Sort ascending"}
        onClick={() => onChange({ order: options.order === "asc" ? "desc" : "asc" })}
      >
        {options.order === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
      </Button>

      <div className="flex rounded-lg border p-0.5">
        <Button
          variant={options.view === "list" ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label="List view"
          aria-pressed={options.view === "list"}
          onClick={() => onChange({ view: "list" })}
        >
          <ListIcon />
        </Button>
        <Button
          variant={options.view === "grid" ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label="Grid view"
          aria-pressed={options.view === "grid"}
          onClick={() => onChange({ view: "grid" })}
        >
          <LayoutGridIcon />
        </Button>
      </div>
    </div>
  )
}

function NodeList({ nodes, options }: { nodes: BrowserNode[]; options: BrowserOptions }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Type</TableHead>
            <TableHead className="hidden w-32 sm:table-cell">Size</TableHead>
            <TableHead className="hidden w-36 lg:table-cell">Modified</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map((node) => (
            <TableRow key={node.id}>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <NodeIcon node={node} />
                  {node.kind === "folder" ? (
                    <Link className="truncate font-medium hover:underline" href={folderURL(node.id, options)}>{node.name}</Link>
                  ) : (
                    <span className="truncate font-medium">{node.name}</span>
                  )}
                  {node.isFavorite && <StarIcon className="size-3.5 shrink-0 fill-current text-muted-foreground" aria-label="Favorite" />}
                </div>
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{nodeType(node)}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">{node.kind === "file" && node.size != null ? formatBytes(node.size) : "—"}</TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell" title={node.updatedAt}>{formatDate(node.updatedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function NodeGrid({ nodes, options }: { nodes: BrowserNode[]; options: BrowserOptions }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {nodes.map((node) => {
        const content = (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="grid size-10 place-items-center rounded-lg bg-muted">
                <NodeIcon node={node} className="size-5" />
              </div>
              {node.isFavorite && <StarIcon className="size-3.5 fill-current text-muted-foreground" aria-label="Favorite" />}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{node.name}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {node.kind === "file" && node.size != null ? `${nodeType(node)} · ${formatBytes(node.size)}` : nodeType(node)}
              </div>
            </div>
          </>
        )

        return node.kind === "folder" ? (
          <Link key={node.id} href={folderURL(node.id, options)} className="flex min-h-32 flex-col justify-between gap-4 rounded-xl border p-3 transition-colors hover:bg-muted/50">
            {content}
          </Link>
        ) : (
          <div key={node.id} className="flex min-h-32 flex-col justify-between gap-4 rounded-xl border p-3">
            {content}
          </div>
        )
      })}
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
          <p className="text-sm text-muted-foreground">Folders and uploaded files will appear here.</p>
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