"use client"

import type { MouseEvent } from "react"
import { Fragment, useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, LayoutGridIcon, ListIcon, MoreHorizontalIcon, RefreshCwIcon, Share2Icon, SlidersHorizontalIcon, UploadIcon } from "lucide-react"
import { AccessDialog } from "@/components/access/access-dialog"
import { CreateFolderDialog } from "@/components/files/node-actions"
import { useUploadTarget } from "@/components/uploads/upload-target"
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Node, NodePage } from "@/lib/api/models"
import type { BrowserOptions, BrowserSort } from "@/lib/files/browser"
import { folderBrowserURL } from "@/lib/files/navigation"

export function FileBrowserChrome({
  folder,
  breadcrumbs,
  accessLevel,
  options,
  itemCount,
  hasMore,
  reloading,
  onNavigate,
  onReload,
  onOptionsChange,
}: {
  folder: Node
  breadcrumbs: readonly Node[]
  accessLevel: NodePage["accessLevel"]
  options: BrowserOptions
  itemCount: number
  hasMore: boolean
  reloading: boolean
  onNavigate: (folderId: string) => void
  onReload: () => Promise<void>
  onOptionsChange: (patch: Partial<BrowserOptions>) => void
}) {
  const uploadTarget = useUploadTarget()
  const [shareOpen, setShareOpen] = useState(false)
  const editable = accessLevel !== "view"
  const shareable = accessLevel === "full"

  function changeSort(sort: BrowserSort) {
    onOptionsChange({ sort, order: sort === "name" ? "asc" : "desc" })
  }

  return (
    <>
      <BrowserBreadcrumbs items={breadcrumbs} options={options} onNavigate={onNavigate} />

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{folder.isRoot ? "Files" : folder.name}</h1>
          <p className="text-sm text-muted-foreground">{itemCount}{hasMore ? "+" : ""} items</p>
        </div>

        <div className="hidden items-center gap-2 sm:flex">
          {editable && <CreateFolderDialog folder={folder} onReload={onReload} />}
          {editable && uploadTarget && (
            <Button size="sm" variant="outline" onClick={uploadTarget.open}>
              <UploadIcon />
              Upload
            </Button>
          )}
          <Button size="icon-sm" variant="outline" disabled={reloading} aria-label="Reload folder" onClick={() => void onReload()}>
            <RefreshCwIcon className={reloading ? "animate-spin" : undefined} />
          </Button>
          <DesktopControls options={options} onChange={onOptionsChange} onSortChange={changeSort} />
          <FolderActionsMenu folder={folder} options={options} canShare={shareable} onShare={() => setShareOpen(true)} />
        </div>

        <div className="flex items-center justify-end gap-2 sm:hidden">
          {editable && <CreateFolderDialog folder={folder} onReload={onReload} />}
          {editable && uploadTarget && (
            <Button size="icon-sm" variant="outline" aria-label="Upload files" onClick={uploadTarget.open}>
              <UploadIcon />
            </Button>
          )}
          <FolderActionsMenu folder={folder} options={options} canShare={shareable} mobile reloading={reloading} onReload={onReload} onShare={() => setShareOpen(true)} onOptionsChange={onOptionsChange} />
        </div>
      </div>

      {shareable && <AccessDialog resource={{ type: "folder", id: folder.id, name: folder.isRoot ? "Files" : folder.name }} open={shareOpen} onOpenChange={setShareOpen} trigger={null} />}
    </>
  )
}

function BrowserBreadcrumbs({ items, options, onNavigate }: { items: readonly Node[]; options: BrowserOptions; onNavigate: (folderId: string) => void }) {
  const collapsed = items.length > 4
  const first = items[0]
  const middle = collapsed ? items.slice(1, -2) : []
  const visible = collapsed ? items.slice(-2) : items

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        {collapsed && first && (
          <>
            <BreadcrumbEntry item={first} options={options} onNavigate={onNavigate} />
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded-md outline-none hover:text-foreground">
                  <BreadcrumbEllipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {middle.map((item) => (
                    <DropdownMenuItem key={item.id} onSelect={() => onNavigate(item.id)}>{item.isRoot ? "Files" : item.name}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        )}

        {visible.map((item, index) => {
          const current = index === visible.length - 1
          return (
            <Fragment key={item.id}>
              {index > 0 && <BreadcrumbSeparator />}
              {current ? (
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="truncate">{item.isRoot ? "Files" : item.name}</BreadcrumbPage>
                </BreadcrumbItem>
              ) : (
                <BreadcrumbEntry item={item} options={options} onNavigate={onNavigate} />
              )}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function BreadcrumbEntry({ item, options, onNavigate }: { item: Node; options: BrowserOptions; onNavigate: (folderId: string) => void }) {
  return (
    <BreadcrumbItem className="min-w-0">
      <BreadcrumbLink asChild>
        <a href={folderBrowserURL(item.id, options)} className="max-w-36 truncate" onClick={(event) => navigateFolderLink(event, item.id, onNavigate)}>
          {item.isRoot ? "Files" : item.name}
        </a>
      </BreadcrumbLink>
    </BreadcrumbItem>
  )
}

function DesktopControls({ options, onChange, onSortChange }: { options: BrowserOptions; onChange: (patch: Partial<BrowserOptions>) => void; onSortChange: (sort: BrowserSort) => void }) {
  return (
    <>
      <Select value={options.sort} onValueChange={(value) => onSortChange(value as BrowserSort)}>
        <SelectTrigger size="sm" className="w-30">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="name">Name</SelectItem>
          <SelectItem value="updated">Modified</SelectItem>
          <SelectItem value="size">Size</SelectItem>
        </SelectContent>
      </Select>

      <Button size="icon-sm" variant="outline" aria-label={options.order === "asc" ? "Sort descending" : "Sort ascending"} onClick={() => onChange({ order: options.order === "asc" ? "desc" : "asc" })}>
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
    </>
  )
}

function FolderActionsMenu({
  folder,
  options,
  canShare,
  mobile = false,
  reloading = false,
  onReload,
  onShare,
  onOptionsChange,
}: {
  folder: Node
  options: BrowserOptions
  canShare: boolean
  mobile?: boolean
  reloading?: boolean
  onReload?: () => Promise<void>
  onShare: () => void
  onOptionsChange?: (patch: Partial<BrowserOptions>) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="outline" aria-label="Folder actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {mobile && onReload && (
          <DropdownMenuItem disabled={reloading} onSelect={() => void onReload()}>
            <RefreshCwIcon className={reloading ? "animate-spin" : undefined} />
            Reload
          </DropdownMenuItem>
        )}

        <DropdownMenuItem asChild>
          <a href={`/api/backend/api/v1/folders/${encodeURIComponent(folder.id)}/download`}>
            <DownloadIcon />
            Download folder
          </a>
        </DropdownMenuItem>

        {canShare && (
          <DropdownMenuItem onSelect={onShare}>
            <Share2Icon />
            Manage access
          </DropdownMenuItem>
        )}

        {mobile && onOptionsChange && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SlidersHorizontalIcon />
                Sort
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={options.sort} onValueChange={(value) => onOptionsChange({ sort: value as BrowserSort, order: value === "name" ? "asc" : "desc" })}>
                  <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="updated">Modified</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem onSelect={() => onOptionsChange({ order: options.order === "asc" ? "desc" : "asc" })}>
              {options.order === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
              {options.order === "asc" ? "Ascending" : "Descending"}
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {options.view === "list" ? <ListIcon /> : <LayoutGridIcon />}
                View
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={options.view} onValueChange={(value) => onOptionsChange({ view: value as BrowserOptions["view"] })}>
                  <DropdownMenuRadioItem value="list">
                    <ListIcon />
                    List
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="grid">
                    <LayoutGridIcon />
                    Grid
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function navigateFolderLink(event: MouseEvent<HTMLAnchorElement>, folderId: string, navigate: (folderId: string) => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigate(folderId)
}