"use client"

import { FileBrowserList as SharedFileBrowserList } from "@discloud/app-ui/files/file-browser-list"
import { useRouter } from "next/navigation"

import { useWorkspace } from "@/components/app/workspace-context"
import { DateOnly } from "@/components/common/date-time"
import { NodeActionsMenu } from "@/components/files/actions/node-actions-menu"
import { browserContextTargets, type BrowserItemsViewProps } from "@/components/files/browser/file-browser-item-shared"
import { FileNodeContextMenu } from "@/components/files/file-node-context-menu"
import { FileNodeVisual } from "@/components/files/file-node-visual"
import type { BrowserNode } from "@/lib/api/models"
import { fileBrowserPath, folderBrowserURL } from "@/lib/files/navigation"

export function FileBrowserList(props: BrowserItemsViewProps) {
  const router = useRouter()
  const workspace = useWorkspace()

  function open(node: BrowserNode) {
    if (node.kind === "folder") props.onNavigate(node.id)
    else router.push(fileBrowserPath(workspace.username, node.id))
  }

  return (
    <SharedFileBrowserList
      nodes={props.nodes}
      parent={props.parent}
      selection={{ selected: props.selected, onSelect: props.onSelect, onSelectAll: props.onSelectAll }}
      folderHref={(folderId, isRoot) => folderBrowserURL(workspace.username, isRoot ? undefined : folderId, props.options)}
      fileHref={(fileId) => fileBrowserPath(workspace.username, fileId)}
      onNavigateFolder={(folderId) => props.onNavigate(folderId)}
      onOpenFile={(fileId) => router.push(fileBrowserPath(workspace.username, fileId))}
      renderNodeVisual={(node, className, iconClassName) => <FileNodeVisual node={node} className={className} iconClassName={iconClassName} />}
      renderNodeActions={(node) => <NodeActionsMenu node={node} folder={props.folder} breadcrumbs={props.breadcrumbs} page={props.page} options={props.options} onReload={props.onReload} onMoved={props.onMoved} onFavorite={props.onFavorite} onOpen={open} />}
      renderModified={(node) => <DateOnly value={node.updatedAt} />}
      wrapNode={(node, children) => <FileNodeContextMenu node={node} targets={browserContextTargets(props, node)} favoritePending={props.favoritePending} onOpen={open} onMove={props.onMoveTargets} onTrash={props.onTrashTargets} onFavorite={props.onFavoriteTargets} onReload={props.onReload}>{children}</FileNodeContextMenu>}
    />
  )
}