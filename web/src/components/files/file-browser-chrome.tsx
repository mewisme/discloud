"use client"

import { useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, Globe2Icon, LayoutGridIcon, ListIcon, MoreHorizontalIcon, RefreshCwIcon, Share2Icon, SlidersHorizontalIcon, UploadIcon } from "lucide-react"
import { AccessDialog } from "@/components/access/access-dialog"
import { CreateFolderDialog } from "@/components/files/node-actions"
import { CompactBreadcrumbs } from "@/components/navigation/compact-breadcrumbs"
import { PublicShareDialog } from "@/components/shares/public-share-dialog"
import { useUploadTarget } from "@/components/uploads/upload-target"
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
  const [accessOpen, setAccessOpen] = useState(false)
  const [publicShareOpen, setPublicShareOpen] = useState(false)
  const editable = accessLevel !== "view"
  const shareable = accessLevel === "full"
  const breadcrumbItems = breadcrumbs.map((item) => ({
    id: item.id,
    label: item.isRoot ? "Files" : item.name,
    href: folderBrowserURL(item.id, options),
  }))

  function changeSort(sort: BrowserSort) {
    onOptionsChange({ sort, order: sort === "name" ? "asc" : "desc" })
  }

  return (
    <>
      <CompactBreadcrumbs items={breadcrumbItems} onNavigate={(item) => onNavigate(item.id)} />

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
          <FolderActionsMenu folder={folder} options={options} canShare={shareable} onAccess={() => setAccessOpen(true)} onPublicShare={() => setPublicShareOpen(true)} />
        </div>

        <div className="flex items-center justify-end gap-2 sm:hidden">
          {editable && <CreateFolderDialog folder={folder} onReload={onReload} />}
          {editable && uploadTarget && (
            <Button size="icon-sm" variant="outline" aria-label="Upload files" onClick={uploadTarget.open}>
              <UploadIcon />
            </Button>
          )}
          <FolderActionsMenu folder={folder} options={options} canShare={shareable} mobile reloading={reloading} onReload={onReload} onAccess={() => setAccessOpen(true)} onPublicShare={() => setPublicShareOpen(true)} onOptionsChange={onOptionsChange} />
        </div>
      </div>

      {shareable && (
        <>
          <AccessDialog resource={{ type: "folder", id: folder.id, name: folder.isRoot ? "Files" : folder.name }} open={accessOpen} onOpenChange={setAccessOpen} trigger={null} />
          <PublicShareDialog resourceType="folder" resourceId={folder.id} resourceName={folder.isRoot ? "Files" : folder.name} open={publicShareOpen} onOpenChange={setPublicShareOpen} trigger={null} />
        </>
      )}
    </>
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
  onAccess,
  onPublicShare,
  onOptionsChange,
}: {
  folder: Node
  options: BrowserOptions
  canShare: boolean
  mobile?: boolean
  reloading?: boolean
  onReload?: () => Promise<void>
  onAccess: () => void
  onPublicShare: () => void
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
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAccess}>
              <Share2Icon />
              Manage access
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPublicShare}>
              <Globe2Icon />
              Public link
            </DropdownMenuItem>
          </>
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