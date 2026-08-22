"use client"

import { DockFileBrowserControls, InlineFileBrowserControls } from "@discloud/app-ui/files/file-browser-controls"
import { FolderPlusIcon, RefreshCwIcon, UploadIcon } from "lucide-react"

import { BottomDock } from "@/components/app/bottom-dock-stack"
import { CreateFolderDialog } from "@/components/files/actions/create-folder-dialog"
import { FolderActionsMenu } from "@/components/files/browser/folder-actions-menu"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { useUploadTarget } from "@/components/uploads/upload-target"
import type { Node, UserConfig } from "@/lib/api/models"
import type { BrowserOptions, BrowserSort } from "@/lib/files/browser"
import { FILE_BROWSER_CREATE_FOLDER_EVENT } from "@/lib/files/commands"

type ToolbarConfig = UserConfig["common"]["fileBrowserToolbar"]

export type FileBrowserToolbarProps = {
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

export function HorizontalFileBrowserToolbar({
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
}: FileBrowserToolbarProps) {
  return (
    <>
      {editable && <CreateFolderDialog folder={folder} onReload={onReload} openEvent={FILE_BROWSER_CREATE_FOLDER_EVENT} />}

      {editable && uploadTarget && (
        <Button variant="outline" onClick={uploadTarget.open}>
          <UploadIcon />
          Upload
          <KbdGroup><Kbd>U</Kbd></KbdGroup>
        </Button>
      )}

      <Button variant="outline" disabled={reloading} aria-label="Reload folder" onClick={() => void onReload()}>
        <RefreshCwIcon className={reloading ? "animate-spin" : undefined} />
        <KbdGroup><Kbd>R</Kbd></KbdGroup>
      </Button>

      <InlineFileBrowserControls options={options} onChange={onOptionsChange} onSortChange={onSortChange} />

      <FolderActionsMenu
        folder={folder}
        options={options}
        canShare={shareable}
        onAccess={onAccess}
        onPublicShare={onPublicShare}
      />
    </>
  )
}

export function DockedFileBrowserToolbar({
  dockPosition,
  selectionActive,
  ...props
}: FileBrowserToolbarProps & {
  dockPosition: ToolbarConfig["dockPosition"]
  selectionActive: boolean
}) {
  if (dockPosition === "right") {
    return (
      <div className="pointer-events-none fixed right-[calc(1rem+env(safe-area-inset-right))] top-1/2 z-30 hidden -translate-y-1/2 sm:block">
        <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md">
          <VerticalFileBrowserToolbar {...props} />
        </div>
      </div>
    )
  }

  return (
    <BottomDock slot="file-browser" className="hidden sm:block">
      <div
        data-selection-active={selectionActive || undefined}
        className="flex items-center gap-2 rounded-2xl border bg-background/95 p-2 shadow-xl backdrop-blur-md"
      >
        <HorizontalFileBrowserToolbar {...props} />
      </div>
    </BottomDock>
  )
}

function VerticalFileBrowserToolbar({
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
}: FileBrowserToolbarProps) {
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

      <Button
        size="icon"
        variant="outline"
        disabled={reloading}
        aria-label="Reload folder"
        title="Reload folder"
        onClick={() => void onReload()}
      >
        <RefreshCwIcon className={reloading ? "animate-spin" : undefined} />
      </Button>

      <DockFileBrowserControls options={options} onChange={onOptionsChange} onSortChange={onSortChange} />

      <FolderActionsMenu
        folder={folder}
        options={options}
        canShare={shareable}
        onAccess={onAccess}
        onPublicShare={onPublicShare}
      />
    </>
  )
}