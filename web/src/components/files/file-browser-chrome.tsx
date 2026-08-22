"use client"

import { FileBrowserHeader } from "@discloud/app-ui/files/file-browser-header"
import { UploadIcon } from "lucide-react"
import { useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"

import { AccessDialog } from "@/components/access/access-dialog"
import { useWorkspace } from "@/components/app/workspace-context"
import { CreateFolderDialog } from "@/components/files/actions/create-folder-dialog"
import { DockedFileBrowserToolbar, HorizontalFileBrowserToolbar } from "@/components/files/browser/file-browser-toolbar"
import { FolderActionsMenu } from "@/components/files/browser/folder-actions-menu"
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
    isRoot: item.isRoot,
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

  const headerActions = (
    <>
      {toolbarConfig.variant === "inline" ? (
        <div className="hidden items-center gap-2 sm:flex">
          <HorizontalFileBrowserToolbar {...toolbarProps} />
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 sm:hidden">
        {editable ? <CreateFolderDialog folder={folder} onReload={onReload} /> : null}

        {editable && uploadTarget ? (
          <Button size="icon-sm" variant="outline" aria-label="Upload files" onClick={uploadTarget.open}>
            <UploadIcon />
          </Button>
        ) : null}

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
    </>
  )

  return (
    <>
      <FileBrowserHeader folder={folder} breadcrumbs={breadcrumbItems} itemCount={itemCount} hasMore={hasMore} actions={headerActions} onNavigate={(item) => onNavigate(item.id)} />

      {toolbarConfig.variant === "dock"
        ? <DockedFileBrowserToolbar {...toolbarProps} dockPosition={toolbarConfig.dockPosition} selectionActive={selectionActive} />
        : null}

      {shareable ? (
        <>
          <AccessDialog resource={{ type: "folder", id: folder.id, name: folder.isRoot ? "Files" : folder.name }} open={accessOpen} onOpenChange={setAccessOpen} trigger={null} />
          <PublicShareDialog resourceType="folder" resourceId={folder.id} resourceName={folder.isRoot ? "Files" : folder.name} open={publicShareOpen} onOpenChange={setPublicShareOpen} trigger={null} />
        </>
      ) : null}
    </>
  )
}