"use client"

import { cn } from "@discloud/ui/lib/utils"
import { useHotkeys } from "react-hotkeys-hook"
import { useShallow } from "zustand/react/shallow"

import { PaginationTrigger } from "@/components/common/pagination-trigger"
import { MoveNodesDialog } from "@/components/files/actions/move-nodes-dialog"
import { TrashNodesDialog } from "@/components/files/actions/trash-nodes-dialog"
import { FileBrowserSelectionToolbar } from "@/components/files/browser/file-browser-selection-toolbar"
import { useFileBrowserController } from "@/components/files/browser/use-file-browser-controller"
import { useFileBrowserSelection } from "@/components/files/browser/use-file-browser-selection"
import { FileBrowserChrome } from "@/components/files/file-browser-chrome"
import { BrowserItems } from "@/components/files/file-browser-items"
import { useUserConfigSelector } from "@/components/settings/user-config-context"
import { FileUploadTarget } from "@/components/uploads/upload-target"
import type { Node, NodePage, UserConfig } from "@/lib/api/models"
import type { BrowserOptions } from "@/lib/files/browser"

type FileBrowserProps = {
  folder: Node
  breadcrumbs: readonly Node[]
  initialPage: NodePage
  options: BrowserOptions
}

export function FileBrowser({ folder: initialFolder, breadcrumbs: initialBreadcrumbs, initialPage, options: initialOptions }: FileBrowserProps) {
  const toolbarConfig = useUserConfigSelector(useShallow((config: UserConfig) => config.common.fileBrowserToolbar))
  const browser = useFileBrowserController({ initialFolder, initialBreadcrumbs, initialPage, initialOptions })
  const selection = useFileBrowserSelection({ nodes: browser.nodes, resetVersion: browser.resetVersion, tableLoading: browser.tableLoading, updateNodes: browser.updateNodes })
  const horizontalToolbarDocked = toolbarConfig.variant === "dock" && toolbarConfig.dockPosition === "bottom"
  const rightToolbarDocked = toolbarConfig.variant === "dock" && toolbarConfig.dockPosition === "right"
  const mergeHorizontalDocks = horizontalToolbarDocked && selection.selectedNodes.length > 0

  useHotkeys("r", () => void browser.reloadCurrent(), { enabled: selection.shortcutsEnabled }, [browser.reloadCurrent, selection.shortcutsEnabled])

  return (
    <FileUploadTarget folderId={browser.folder.id} disabled={browser.accessLevel === "view"}>
      <div
        className={cn(
          "mx-auto flex w-full max-w-7xl flex-col gap-5",
          horizontalToolbarDocked && selection.selectedNodes.length === 0 && "pb-24",
          horizontalToolbarDocked && selection.selectedNodes.length > 0 && "pb-40",
          !horizontalToolbarDocked && selection.selectedNodes.length > 0 && "pb-28",
          rightToolbarDocked && "pr-14 sm:pr-16",
        )}
      >
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {selection.selectedNodes.length === 0 ? "No items selected" : `${selection.selectedNodes.length} item${selection.selectedNodes.length === 1 ? "" : "s"} selected`}
        </p>

        <FileBrowserChrome
          folder={browser.folder}
          breadcrumbs={browser.breadcrumbs}
          accessLevel={browser.accessLevel}
          options={browser.options}
          itemCount={browser.nodes.length}
          hasMore={!!browser.nextCursor}
          reloading={browser.tableLoading}
          toolbarConfig={toolbarConfig}
          selectionActive={selection.selectedNodes.length > 0}
          onNavigate={(folderId) => void browser.navigateFolder(folderId)}
          onReload={browser.reloadCurrent}
          onOptionsChange={browser.updateOptions}
        />

        <FileBrowserSelectionToolbar
          selectedNodes={selection.selectedNodes}
          favoritePending={selection.favoritePending}
          mergeHorizontalDocks={mergeHorizontalDocks}
          canMove={selection.bulkCanMove}
          canTrash={selection.bulkCanTrash}
          canFavorite={selection.bulkCanFavorite}
          canUnfavorite={selection.bulkCanUnfavorite}
          onMove={() => selection.setMoveTargets([...selection.selectedNodes])}
          onTrash={() => selection.setTrashTargets([...selection.selectedNodes])}
          onFavorite={() => void selection.setNodesFavorite(selection.selectedNodes, true)}
          onUnfavorite={() => void selection.setNodesFavorite(selection.selectedNodes, false)}
          onClear={selection.clearSelection}
        />

        {selection.moveTargets ? (
          <MoveNodesDialog
            nodes={selection.moveTargets}
            folder={browser.folder}
            breadcrumbs={browser.breadcrumbs}
            initialPage={browser.currentPage}
            options={browser.options}
            open
            onOpenChange={(open) => { if (!open) selection.setMoveTargets(undefined) }}
            onMoved={browser.removeNodes}
          />
        ) : null}

        {selection.trashTargets ? (
          <TrashNodesDialog nodes={selection.trashTargets} open onOpenChange={(open) => { if (!open) selection.setTrashTargets(undefined) }} onTrashed={browser.removeNodes} />
        ) : null}

        <BrowserItems
          nodes={browser.nodes}
          folder={browser.folder}
          breadcrumbs={browser.breadcrumbs}
          page={browser.currentPage}
          options={browser.options}
          selected={selection.selected}
          loading={browser.tableLoading}
          favoritePending={selection.favoritePending}
          onNavigate={(folderId) => void browser.navigateFolder(folderId)}
          onSelect={selection.select}
          onSelectAll={selection.selectAll}
          onMoveTargets={(targets) => selection.setMoveTargets([...targets])}
          onTrashTargets={(targets) => selection.setTrashTargets([...targets])}
          onFavoriteTargets={selection.setNodesFavorite}
          onFavorite={selection.setFavorite}
          onMoved={(nodeId) => browser.removeNodes([nodeId])}
          onReload={() => browser.reloadChildren()}
        />

        {browser.nextCursor ? (
          <PaginationTrigger loadKey={browser.nextCursor} hasMore loading={browser.loadingMore} onLoadMore={browser.loadMore} loadingLabel="Loading more items…" />
        ) : null}
      </div>
    </FileUploadTarget>
  )
}
