"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FileTextIcon, FileVideoIcon, FolderIcon, FolderOpenIcon, FolderUpIcon, Loader2Icon, StarIcon } from "lucide-react"
import { NodeActionsMenu } from "@/components/files/node-actions"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { BrowserNode, Node, NodePage } from "@/lib/api/models"
import type { BrowserOptions } from "@/lib/files/browser"
import { folderBrowserURL } from "@/lib/files/navigation"
import { formatBytes, handleClientNavigation, isInteractiveTarget } from "@/lib/helpers"
import { DateOnly } from "@/components/common/date-time"
import { FileNodeContextMenu } from "@/components/files/file-node-context-menu"

type BrowserItemsProps = {
  nodes: BrowserNode[]
  folder: Node
  breadcrumbs: readonly Node[]
  page: NodePage
  options: BrowserOptions
  selected: ReadonlySet<string>
  loading: boolean
  favoritePending: boolean
  onMoveTargets: (nodes: readonly BrowserNode[]) => void
  onTrashTargets: (nodes: readonly BrowserNode[]) => void
  onFavoriteTargets: (nodes: readonly BrowserNode[], favorite: boolean) => Promise<void>
  onNavigate: (folderId: string) => void
  onSelect: (nodeId: string, selected: boolean) => void
  onSelectAll: (selected: boolean) => void
  onFavorite: (node: BrowserNode, favorite: boolean) => Promise<void>
  onMoved: (nodeId: string) => void
  onReload: () => Promise<void>
}

export function BrowserItems(props: BrowserItemsProps) {
  const parent = props.folder.isRoot ? undefined : props.breadcrumbs.at(-2)
  const empty = props.nodes.length === 0 && !parent

  return (
    <div className="relative min-h-24" aria-busy={props.loading}>
      {empty ? <EmptyFolder /> : props.options.view === "grid" ? <NodeGrid {...props} parent={parent} /> : <NodeList {...props} parent={parent} />}
      {props.loading && (
        <div className="absolute inset-0 z-10 grid min-h-24 place-items-center rounded-xl bg-background/70 backdrop-blur-[1px]">
          <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
            Loading folder…
          </div>
        </div>
      )}
    </div>
  )
}

function NodeList(props: BrowserItemsProps & { parent?: Node }) {
  const router = useRouter()
  const allSelected = props.nodes.length > 0 && props.nodes.every((node) => props.selected.has(node.id))
  const someSelected = props.nodes.some((node) => props.selected.has(node.id))

  function open(node: BrowserNode) {
    if (node.kind === "folder") props.onNavigate(node.id)
    else router.push(`/files/file/${node.id}`)
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} aria-label="Select all loaded items" onCheckedChange={(value) => props.onSelectAll(value === true)} />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Type</TableHead>
            <TableHead className="hidden w-28 sm:table-cell">Size</TableHead>
            <TableHead className="hidden w-36 lg:table-cell">Modified</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.parent && (
            <TableRow className="select-none">
              <TableCell />
              <TableCell>
                <a
                  className="flex items-center gap-2 font-medium hover:underline"
                  href={folderBrowserURL(props.parent.id, props.options)}
                  onClick={(event) => handleClientNavigation(event, () => props.onNavigate(props.parent!.id))}
                >
                  <FolderUpIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span>..</span>
                </a>
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">Parent folder</TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden lg:table-cell" />
              <TableCell />
            </TableRow>
          )}

          {props.nodes.map((node) => (
            <FileNodeContextMenu
              key={node.id}
              node={node}
              targets={contextTargets(props, node)}
              favoritePending={props.favoritePending}
              onOpen={open}
              onMove={props.onMoveTargets}
              onTrash={props.onTrashTargets}
              onFavorite={props.onFavoriteTargets}
              onReload={props.onReload}
            >
              <TableRow
                className="select-none"
                data-state={props.selected.has(node.id) ? "selected" : undefined}
                onDoubleClick={(event) => {
                  if (!isInteractiveTarget(event.target)) open(node)
                }}
              >
                <TableCell>
                  <Checkbox checked={props.selected.has(node.id)} aria-label={`Select ${node.name}`} onCheckedChange={(value) => props.onSelect(node.id, value === true)} />
                </TableCell>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    <NodeIcon node={node} />
                    {node.kind === "folder" ? (
                      <a className="truncate font-medium hover:underline" href={folderBrowserURL(node.id, props.options)} onClick={(event) => handleClientNavigation(event, () => props.onNavigate(node.id))}>{node.name}</a>
                    ) : (
                      <Link className="truncate font-medium hover:underline" href={`/files/file/${node.id}`}>{node.name}</Link>
                    )}
                    {node.isFavorite && <StarIcon className="size-3.5 shrink-0 fill-current text-muted-foreground" aria-label="Favorite" />}
                  </div>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{nodeType(node)}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{node.kind === "file" && node.size != null ? formatBytes(node.size) : "—"}</TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell" title={node.updatedAt}><DateOnly value={node.updatedAt} /></TableCell>
                <TableCell>
                  <NodeActionsMenu node={node} folder={props.folder} breadcrumbs={props.breadcrumbs} page={props.page} options={props.options} onReload={props.onReload} onMoved={props.onMoved} onFavorite={props.onFavorite} />
                </TableCell>
              </TableRow>
            </FileNodeContextMenu>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function NodeGrid(props: BrowserItemsProps & { parent?: Node }) {
  const router = useRouter()

  function open(node: BrowserNode) {
    if (node.kind === "folder") props.onNavigate(node.id)
    else router.push(`/files/file/${node.id}`)
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {props.parent && (
        <button type="button" className="flex min-w-0 items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/50" onClick={() => props.onNavigate(props.parent!.id)}>
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
            <FolderUpIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="font-medium">..</p>
            <p className="text-xs text-muted-foreground">Parent folder</p>
          </div>
        </button>
      )}

      {props.nodes.map((node) => (
        <FileNodeContextMenu
          key={node.id}
          node={node}
          targets={contextTargets(props, node)}
          favoritePending={props.favoritePending}
          onOpen={open}
          onMove={props.onMoveTargets}
          onTrash={props.onTrashTargets}
          onFavorite={props.onFavoriteTargets}
          onReload={props.onReload}
        >
          <div
            className="group flex min-w-0 items-center gap-2 rounded-xl border bg-card p-2.5 transition-colors hover:bg-muted/40 data-[selected=true]:bg-muted/60"
            data-selected={props.selected.has(node.id)}
            onDoubleClick={(event) => {
              if (!isInteractiveTarget(event.target)) open(node)
            }}
          >
            <Checkbox className="shrink-0" checked={props.selected.has(node.id)} aria-label={`Select ${node.name}`} onCheckedChange={(value) => props.onSelect(node.id, value === true)} />
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
              <NodeIcon node={node} className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              {node.kind === "folder" ? (
                <a className="block truncate text-sm font-medium hover:underline" href={folderBrowserURL(node.id, props.options)} onClick={(event) => handleClientNavigation(event, () => props.onNavigate(node.id))}>{node.name}</a>
              ) : (
                <Link className="block truncate text-sm font-medium hover:underline" href={`/files/file/${node.id}`}>{node.name}</Link>
              )}
              <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <span className="truncate">{node.kind === "file" && node.size != null ? `${nodeType(node)} · ${formatBytes(node.size)}` : nodeType(node)}</span>
                {node.isFavorite && <StarIcon className="size-3 shrink-0 fill-current" aria-label="Favorite" />}
              </div>
            </div>
            <div className="shrink-0 sm:opacity-60 sm:transition-opacity sm:group-hover:opacity-100">
              <NodeActionsMenu node={node} folder={props.folder} breadcrumbs={props.breadcrumbs} page={props.page} options={props.options} onReload={props.onReload} onMoved={props.onMoved} onFavorite={props.onFavorite} />
            </div>
          </div>
        </FileNodeContextMenu>
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
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div className="space-y-2">
        <div className="mx-auto grid size-11 place-items-center rounded-xl bg-muted">
          <FolderOpenIcon className="size-5 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">Empty folder</p>
          <p className="text-sm text-muted-foreground">Drop files here or create a folder.</p>
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

function contextTargets(props: BrowserItemsProps, node: BrowserNode) {
  if (!props.selected.has(node.id)) return [node]

  const targets = props.nodes.filter((item) => props.selected.has(item.id))
  return targets.length ? targets : [node]
}