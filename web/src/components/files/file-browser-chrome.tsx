"use client"

import { UploadIcon } from "lucide-react"
import { useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"

import { AccessDialog } from "@/components/access/access-dialog"
import { useWorkspace } from "@/components/app/workspace-context"
import { CreateFolderDialog } from "@/components/files/actions/create-folder-dialog"
import { DockedFileBrowserToolbar, HorizontalFileBrowserToolbar } from "@/components/files/browser/file-browser-toolbar"
import { FolderActionsMenu } from "@/components/files/browser/folder-actions-menu"
import { CompactBreadcrumbs } from "@/components/navigation/compact-breadcrumbs"
import { PublicShareDialog } from "@/components/shares/public-share-dialog"
import { Button } from "@/components/ui/button"
import { useUploadTarget } from "@/components/uploads/upload-target"
import type { Node, NodePage, UserConfig } from "@/lib/api/models"
import type { BrowserOptions, BrowserSort } from "@/lib/files/browser"
import { folderBrowserURL } from "@/lib/files/navigation"

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
  const workspace = useWorkspace()
  const uploadTarget = useUploadTarget()
  const [accessOpen, setAccessOpen] = useState(false)
  const [publicShareOpen, setPublicShareOpen] = useState(false)
  const editable = accessLevel !== "view"
  const shareable = accessLevel === "full"
  const breadcrumbItems = breadcrumbs.map((item) => ({
    id: item.id,
    label: item.isRoot ? `${workspace.name}'s workspace` : item.name,
    href: folderBrowserURL(workspace.username, item.isRoot ? undefined : item.id, options),
  }))

  function changeSort(sort: BrowserSort) {
    onOptionsChange({ sort, order: sort === "name" ? "asc" : "desc" })
  }

  useHotkeys(["u"], () => {
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
            <HorizontalFileBrowserToolbar {...toolbarProps} />
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
        <DockedFileBrowserToolbar
          {...toolbarProps}
          dockPosition={toolbarConfig.dockPosition}
          selectionActive={selectionActive}
        />
      )}

      {shareable && (
        <>
          <AccessDialog
            resource={{ type: "folder", id: folder.id, name: folder.isRoot ? "Files" : folder.name }}
            open={accessOpen}
            onOpenChange={setAccessOpen}
            trigger={null}
          />

          <PublicShareDialog
            resourceType="folder"
            resourceId={folder.id}
            resourceName={folder.isRoot ? "Files" : folder.name}
            open={publicShareOpen}
            onOpenChange={setPublicShareOpen}
            trigger={null}
          />
        </>
      )}
    </>
  )
}