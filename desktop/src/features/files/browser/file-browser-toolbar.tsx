import type { Node, UserConfig } from "@discloud/api/models"
import { DockFileBrowserControls, InlineFileBrowserControls } from "@discloud/app-ui/files/file-browser-controls"
import type { BrowserOptions, BrowserSort } from "@discloud/shared/file-browser"
import { Button } from "@discloud/ui/components/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@discloud/ui/components/dropdown-menu"
import { Kbd, KbdGroup } from "@discloud/ui/components/kbd"
import { ArrowDownIcon, ArrowUpIcon, FolderPlusIcon, FolderUpIcon, Globe2Icon, LayoutGridIcon, ListIcon, LoaderCircleIcon, MoreHorizontalIcon, RefreshCwIcon, Share2Icon, SlidersHorizontalIcon, UploadIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { DesktopAccessDialog } from "../../access/access-dialog"
import { DesktopPublicShareDialog } from "../../shares/public-share-dialog"
import { useDesktopFileUploadTarget } from "../../uploads/ui/upload-target"
import { DesktopCreateFolderDialog } from "../actions/create-folder-dialog"
import { FILE_BROWSER_CREATE_FOLDER_EVENT } from "../commands"

type ToolbarConfig = UserConfig["common"]["fileBrowserToolbar"]

type DesktopFileBrowserToolbarProps = {
  folder: Node
  options: BrowserOptions
  editable: boolean
  shareable: boolean
  reloading: boolean
  toolbarConfig: ToolbarConfig
  selectionActive: boolean
  onReload: () => void
  onCreated: () => void
  onOptionsChange: (patch: Partial<BrowserOptions>) => void
  onSortChange: (sort: BrowserSort) => void
}

type ToolbarContentProps = Omit<DesktopFileBrowserToolbarProps, "toolbarConfig" | "selectionActive"> & {
  onAccess: () => void
  onPublicShare: () => void
}

export function DesktopFileBrowserToolbar({ toolbarConfig, selectionActive, ...props }: DesktopFileBrowserToolbarProps) {
  const [accessOpen, setAccessOpen] = useState(false)
  const [publicShareOpen, setPublicShareOpen] = useState(false)
  const uploadTarget = useDesktopFileUploadTarget()
  const toolbarProps = { ...props, onAccess: () => setAccessOpen(true), onPublicShare: () => setPublicShareOpen(true) }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return

      const key = event.key.toLowerCase()
      if (key === "u" && props.editable && !uploadTarget.busy) {
        event.preventDefault()
        void uploadTarget.openFiles()
        return
      }

      if (key === "r" && !props.reloading) {
        event.preventDefault()
        props.onReload()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [props.editable, props.onReload, props.reloading, uploadTarget])

  return (
    <>
      {toolbarConfig.variant === "inline" ? (
        <div className="hidden items-center gap-2 sm:flex">
          <HorizontalDesktopFileBrowserToolbar {...toolbarProps} />
        </div>
      ) : toolbarConfig.dockPosition === "right" ? (
        <div className="pointer-events-none fixed right-[calc(1rem+env(safe-area-inset-right))] top-1/2 z-30 hidden -translate-y-1/2 sm:block">
          <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md">
            <VerticalDesktopFileBrowserToolbar {...toolbarProps} />
          </div>
        </div>
      ) : (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 hidden justify-center px-3 sm:flex">
          <div data-selection-active={selectionActive || undefined} className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md">
            <HorizontalDesktopFileBrowserToolbar {...toolbarProps} />
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 sm:hidden">
        {props.editable ? (
          <DesktopCreateFolderDialog
            folder={props.folder}
            onCreated={props.onCreated}
            trigger={<Button size="icon-sm" variant="outline" aria-label="Create folder" title="Create folder"><FolderPlusIcon /></Button>}
          />
        ) : null}

        {props.editable ? (
          <Button size="icon-sm" variant="outline" disabled={uploadTarget.busy} aria-label="Upload files" title="Upload files" onClick={() => void uploadTarget.openFiles()}>
            {uploadTarget.busy ? <LoaderCircleIcon className="animate-spin" /> : <UploadIcon />}
          </Button>
        ) : null}

        <DesktopFolderActionsMenu {...toolbarProps} mobile />
      </div>

      {props.shareable ? (
        <>
          <DesktopAccessDialog
            resource={{ type: "folder", id: props.folder.id, name: props.folder.isRoot ? "Files" : props.folder.name }}
            open={accessOpen}
            onOpenChange={setAccessOpen}
            trigger={null}
          />
          <DesktopPublicShareDialog
            resourceType="folder"
            resourceId={props.folder.id}
            resourceName={props.folder.isRoot ? "Files" : props.folder.name}
            open={publicShareOpen}
            onOpenChange={setPublicShareOpen}
            trigger={null}
          />
        </>
      ) : null}
    </>
  )
}

function HorizontalDesktopFileBrowserToolbar(props: ToolbarContentProps) {
  const uploadTarget = useDesktopFileUploadTarget()

  return (
    <>
      {props.editable ? <DesktopCreateFolderDialog folder={props.folder} onCreated={props.onCreated} openEvent={FILE_BROWSER_CREATE_FOLDER_EVENT} /> : null}

      {props.editable ? (
        <Button variant="outline" disabled={uploadTarget.busy} onClick={() => void uploadTarget.openFiles()}>
          {uploadTarget.busy ? <LoaderCircleIcon className="animate-spin" /> : <UploadIcon />}
          Upload
          <KbdGroup><Kbd>U</Kbd></KbdGroup>
        </Button>
      ) : null}

      <Button variant="outline" disabled={props.reloading} aria-label="Reload folder" onClick={props.onReload}>
        <RefreshCwIcon className={props.reloading ? "animate-spin" : undefined} />
        <KbdGroup><Kbd>R</Kbd></KbdGroup>
      </Button>

      <InlineFileBrowserControls options={props.options} onChange={props.onOptionsChange} onSortChange={props.onSortChange} />
      <DesktopFolderActionsMenu {...props} />
    </>
  )
}

function VerticalDesktopFileBrowserToolbar(props: ToolbarContentProps) {
  const uploadTarget = useDesktopFileUploadTarget()

  return (
    <>
      {props.editable ? (
        <DesktopCreateFolderDialog
          folder={props.folder}
          onCreated={props.onCreated}
          openEvent={FILE_BROWSER_CREATE_FOLDER_EVENT}
          trigger={<Button size="icon" variant="outline" aria-label="Create folder" title="Create folder"><FolderPlusIcon /></Button>}
        />
      ) : null}

      {props.editable ? (
        <Button size="icon" variant="outline" disabled={uploadTarget.busy} aria-label="Upload files" title="Upload files" onClick={() => void uploadTarget.openFiles()}>
          {uploadTarget.busy ? <LoaderCircleIcon className="animate-spin" /> : <UploadIcon />}
        </Button>
      ) : null}

      <Button size="icon" variant="outline" disabled={props.reloading} aria-label="Reload folder" title="Reload folder" onClick={props.onReload}>
        <RefreshCwIcon className={props.reloading ? "animate-spin" : undefined} />
      </Button>

      <DockFileBrowserControls options={props.options} onChange={props.onOptionsChange} onSortChange={props.onSortChange} />
      <DesktopFolderActionsMenu {...props} />
    </>
  )
}

function DesktopFolderActionsMenu({ mobile = false, ...props }: ToolbarContentProps & { mobile?: boolean }) {
  const uploadTarget = useDesktopFileUploadTarget()
  const hasMenu = props.editable || props.shareable || mobile
  if (!hasMenu) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="outline" aria-label="Folder actions" title="Folder actions"><MoreHorizontalIcon /></Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        {mobile ? (
          <DropdownMenuItem disabled={props.reloading} onSelect={props.onReload}>
            <RefreshCwIcon className={props.reloading ? "animate-spin" : undefined} />
            Reload
          </DropdownMenuItem>
        ) : null}

        {props.editable ? (
          <DropdownMenuItem disabled={uploadTarget.busy} onSelect={() => void uploadTarget.openFolders()}>
            <FolderUpIcon />
            Upload folder
          </DropdownMenuItem>
        ) : null}

        {props.shareable ? (
          <>
            {(mobile || props.editable) ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={props.onAccess}><Share2Icon />Manage access</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onPublicShare}><Globe2Icon />Public link</DropdownMenuItem>
          </>
        ) : null}

        {mobile ? (
          <>
            <DropdownMenuSeparator />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger><SlidersHorizontalIcon />Sort</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={props.options.sort} onValueChange={(value) => props.onSortChange(value as BrowserSort)}>
                  <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="updated">Modified</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem onSelect={() => props.onOptionsChange({ order: props.options.order === "asc" ? "desc" : "asc" })}>
              {props.options.order === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
              {props.options.order === "asc" ? "Ascending" : "Descending"}
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{props.options.view === "list" ? <ListIcon /> : <LayoutGridIcon />}View</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={props.options.view} onValueChange={(value) => props.onOptionsChange({ view: value as BrowserOptions["view"] })}>
                  <DropdownMenuRadioItem value="list"><ListIcon />List</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="grid"><LayoutGridIcon />Grid</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.matches("input, textarea, select, [role='textbox']")
}
