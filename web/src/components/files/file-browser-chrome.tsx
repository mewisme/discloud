"use client"

import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, FolderPlusIcon, Globe2Icon, LayoutGridIcon, ListIcon, MoreHorizontalIcon, RefreshCwIcon, Share2Icon, SlidersHorizontalIcon, UploadIcon } from "lucide-react"
import { useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"

import { AccessDialog } from "@/components/access/access-dialog"
import { useCurrentUser } from "@/components/app/current-user-context"
import { CreateFolderDialog } from "@/components/files/node-actions"
import { CompactBreadcrumbs } from "@/components/navigation/compact-breadcrumbs"
import { PublicShareDialog } from "@/components/shares/public-share-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUploadTarget } from "@/components/uploads/upload-target"
import type { Node, NodePage, UserConfig } from "@/lib/api/models"
import type { BrowserOptions, BrowserSort } from "@/lib/files/browser"
import { FILE_BROWSER_CREATE_FOLDER_EVENT } from "@/lib/files/commands"
import { folderBrowserURL } from "@/lib/files/navigation"
import { cn } from "@/lib/utils"

type ToolbarConfig = UserConfig["common"]["fileBrowserToolbar"]

export function FileBrowserChrome({
  folder,
  breadcrumbs,
  accessLevel,
  options,
  itemCount,
  hasMore,
  reloading,
  toolbarConfig,
  selectionActive,
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
  toolbarConfig: ToolbarConfig
  selectionActive: boolean
  onNavigate: (folderId: string) => void
  onReload: () => Promise<void>
  onOptionsChange: (patch: Partial<BrowserOptions>) => void
}) {
  const user = useCurrentUser()
  const uploadTarget = useUploadTarget()
  const [accessOpen, setAccessOpen] = useState(false)
  const [publicShareOpen, setPublicShareOpen] = useState(false)
  const editable = accessLevel !== "view"
  const shareable = accessLevel === "full"
  const breadcrumbItems = breadcrumbs.map((item) => ({
    id: item.id,
    label: item.isRoot ? `${user.username}'s Workspace` : item.name,
    href: folderBrowserURL(item.id, options),
  }))

  function changeSort(sort: BrowserSort) {
    onOptionsChange({ sort, order: sort === "name" ? "asc" : "desc" })
  }

  useHotkeys(["alt+u"], () => {
    if (editable && uploadTarget) uploadTarget.open()
  }, {}, [editable, uploadTarget])

  const toolbarProps = {
    folder,
    options,
    editable,
    shareable,
    reloading,
    uploadTarget,
    onReload,
    onOptionsChange,
    onSortChange: changeSort,
    onAccess: () => setAccessOpen(true),
    onPublicShare: () => setPublicShareOpen(true),
  }

  return (
    <>
      <CompactBreadcrumbs items={breadcrumbItems} onNavigate={(item) => onNavigate(item.id)} />

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{folder.isRoot ? "Files" : folder.name}</h1>
          <p className="text-sm text-muted-foreground">{itemCount}{hasMore ? "+" : ""} items</p>
        </div>

        {toolbarConfig.variant === "inline" && (
          <div className="hidden items-center gap-2 sm:flex">
            <HorizontalToolbar {...toolbarProps} />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 sm:hidden">
          {editable && <CreateFolderDialog folder={folder} onReload={onReload} />}
          {editable && uploadTarget && (
            <Button size="icon-sm" variant="outline" aria-label="Upload files" onClick={uploadTarget.open}>
              <UploadIcon />
            </Button>
          )}
          <FolderActionsMenu
            folder={folder}
            options={options}
            canShare={shareable}
            mobile
            reloading={reloading}
            onReload={onReload}
            onAccess={() => setAccessOpen(true)}
            onPublicShare={() => setPublicShareOpen(true)}
            onOptionsChange={onOptionsChange}
          />
        </div>
      </div>

      {toolbarConfig.variant === "dock" && (
        <DockedToolbar
          {...toolbarProps}
          dockPosition={toolbarConfig.dockPosition}
          selectionActive={selectionActive}
        />
      )}

      {shareable && (
        <>
          <AccessDialog resource={{ type: "folder", id: folder.id, name: folder.isRoot ? "Files" : folder.name }} open={accessOpen} onOpenChange={setAccessOpen} trigger={null} />
          <PublicShareDialog resourceType="folder" resourceId={folder.id} resourceName={folder.isRoot ? "Files" : folder.name} open={publicShareOpen} onOpenChange={setPublicShareOpen} trigger={null} />
        </>
      )}
    </>
  )
}

function HorizontalToolbar({
  folder,
  options,
  editable,
  shareable,
  reloading,
  uploadTarget,
  onReload,
  onOptionsChange,
  onSortChange,
  onAccess,
  onPublicShare,
}: ToolbarProps) {
  return (
    <>
      {editable && <CreateFolderDialog folder={folder} onReload={onReload} openEvent={FILE_BROWSER_CREATE_FOLDER_EVENT} />}

      {editable && uploadTarget && (
        <Button variant="outline" onClick={uploadTarget.open}>
          <UploadIcon />
          Upload
          <KbdGroup><Kbd>Alt + U</Kbd></KbdGroup>
        </Button>
      )}

      <Button variant="outline" disabled={reloading} aria-label="Reload folder" onClick={() => void onReload()}>
        <RefreshCwIcon className={reloading ? "animate-spin" : undefined} />
        <KbdGroup><Kbd>R</Kbd></KbdGroup>
      </Button>

      <DesktopControls options={options} onChange={onOptionsChange} onSortChange={onSortChange} />

      <FolderActionsMenu folder={folder} options={options} canShare={shareable} onAccess={onAccess} onPublicShare={onPublicShare} />
    </>
  )
}

function DockedToolbar({
  dockPosition,
  selectionActive,
  ...props
}: ToolbarProps & {
  dockPosition: ToolbarConfig["dockPosition"]
  selectionActive: boolean
}) {
  if (dockPosition === "right") {
    return (
      <div className="pointer-events-none fixed right-[calc(1rem+env(safe-area-inset-right))] top-1/2 z-30 hidden -translate-y-1/2 sm:block">
        <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md">
          <VerticalToolbar {...props} />
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 hidden justify-center px-3 sm:flex">
      <div className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md">
        <HorizontalToolbar {...props} />
      </div>
    </div>
  )
}

function VerticalToolbar({
  folder,
  options,
  editable,
  shareable,
  reloading,
  uploadTarget,
  onReload,
  onOptionsChange,
  onSortChange,
  onAccess,
  onPublicShare,
}: ToolbarProps) {
  return (
    <>
      {editable && (
        <CreateFolderDialog
          folder={folder}
          onReload={onReload}
          openEvent={FILE_BROWSER_CREATE_FOLDER_EVENT}
          trigger={
            <Button size="icon" variant="outline" aria-label="Create folder" title="Create folder">
              <FolderPlusIcon />
            </Button>
          }
        />
      )}

      {editable && uploadTarget && (
        <Button size="icon" variant="outline" aria-label="Upload files" title="Upload files" onClick={uploadTarget.open}>
          <UploadIcon />
        </Button>
      )}

      <Button size="icon" variant="outline" disabled={reloading} aria-label="Reload folder" title="Reload folder" onClick={() => void onReload()}>
        <RefreshCwIcon className={reloading ? "animate-spin" : undefined} />
      </Button>

      <DockControlsMenu options={options} onChange={onOptionsChange} onSortChange={onSortChange} />

      <FolderActionsMenu folder={folder} options={options} canShare={shareable} onAccess={onAccess} onPublicShare={onPublicShare} />
    </>
  )
}

type ToolbarProps = {
  folder: Node
  options: BrowserOptions
  editable: boolean
  shareable: boolean
  reloading: boolean
  uploadTarget: ReturnType<typeof useUploadTarget>
  onReload: () => Promise<void>
  onOptionsChange: (patch: Partial<BrowserOptions>) => void
  onSortChange: (sort: BrowserSort) => void
  onAccess: () => void
  onPublicShare: () => void
}

function DesktopControls({ options, onChange, onSortChange }: { options: BrowserOptions; onChange: (patch: Partial<BrowserOptions>) => void; onSortChange: (sort: BrowserSort) => void }) {
  return (
    <>
      <Select value={options.sort} onValueChange={(value) => onSortChange(value as BrowserSort)}>
        <SelectTrigger className="w-30">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Sort by</SelectLabel>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="updated">Modified</SelectItem>
            <SelectItem value="size">Size</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      <Button size="icon" variant="outline" aria-label={options.order === "asc" ? "Sort descending" : "Sort ascending"} onClick={() => onChange({ order: options.order === "asc" ? "desc" : "asc" })}>
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

function DockControlsMenu({ options, onChange, onSortChange }: { options: BrowserOptions; onChange: (patch: Partial<BrowserOptions>) => void; onSortChange: (sort: BrowserSort) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="outline" aria-label="View and sort options" title="View and sort options">
          <SlidersHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="left" align="center" className="w-52">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SlidersHorizontalIcon />
            Sort
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={options.sort} onValueChange={(value) => onSortChange(value as BrowserSort)}>
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updated">Modified</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem onSelect={() => onChange({ order: options.order === "asc" ? "desc" : "asc" })}>
          {options.order === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
          {options.order === "asc" ? "Ascending" : "Descending"}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuRadioGroup value={options.view} onValueChange={(value) => onChange({ view: value as BrowserOptions["view"] })}>
          <DropdownMenuRadioItem value="list">
            <ListIcon />
            List
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="grid">
            <LayoutGridIcon />
            Grid
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
        <Button size="icon" variant="outline" aria-label="Folder actions">
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