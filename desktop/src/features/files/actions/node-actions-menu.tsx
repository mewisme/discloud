import type { BrowserNode, Node, NodePage } from "@discloud/api/models"
import { Button } from "@discloud/ui/components/button"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@discloud/ui/components/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@discloud/ui/components/dropdown-menu"
import { DownloadIcon, FolderOpenIcon, FolderSyncIcon, Globe2Icon, Loader2Icon, MoreHorizontalIcon, MoveIcon, PauseIcon, PencilIcon, PlayIcon, RefreshCwIcon, Settings2Icon, Share2Icon, StarIcon, StarOffIcon, Trash2Icon } from "lucide-react"
import { type ReactElement, useState } from "react"

import { DesktopAccessDialog } from "../../access/access-dialog"
import { DesktopPublicShareDialog } from "../../shares/public-share-dialog"
import { DesktopSyncPairDialog } from "../../sync/ui/sync-pair-dialog"
import { useDesktopSync } from "../../sync/ui/sync-provider"
import { DesktopMoveNodesDialog } from "./move-nodes-dialog"
import { DesktopRenameNodeDialog } from "./rename-node-dialog"
import { DesktopTrashNodesDialog } from "./trash-nodes-dialog"

type NodeMenuProps = {
  node: BrowserNode
  folder: Node
  breadcrumbs: readonly Node[]
  page: NodePage
  favoritePending: boolean
  onReload: () => void
  onFavorite: (node: BrowserNode, favorite: boolean) => Promise<void>
  onOpen: (node: BrowserNode) => void
  onDownload: (node: BrowserNode) => Promise<void>
}

type NodeContextMenuProps = Pick<NodeMenuProps, "node" | "favoritePending" | "onReload"> & {
  targets: readonly BrowserNode[]
  children: ReactElement
  onOpen: (node: BrowserNode) => void
  onDownload: (node: BrowserNode) => Promise<void>
  onMove: (nodes: readonly BrowserNode[]) => void
  onTrash: (nodes: readonly BrowserNode[]) => void
  onFavoriteMany: (nodes: readonly BrowserNode[], favorite: boolean) => Promise<void>
}

export function DesktopNodeActionsMenu({ node, folder, breadcrumbs, page, favoritePending, onReload, onFavorite, onOpen, onDownload }: NodeMenuProps) {
  const sync = useDesktopSync()
  const [renameOpen, setRenameOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [publicShareOpen, setPublicShareOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const editable = node.accessLevel !== "view"
  const full = node.accessLevel === "full"
  const syncable = node.kind === "folder"
  const syncPair = syncable ? sync.pairs.find((pair) => pair.remoteFolderId === node.id) : undefined
  const hasSecondaryActions = editable || syncable || full || node.canFavorite

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${node.name}`}><MoreHorizontalIcon /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => onOpen(node)}><FolderOpenIcon />Open</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void onDownload(node)}><DownloadIcon />Download</DropdownMenuItem>
          {hasSecondaryActions ? <DropdownMenuSeparator /> : null}
          {editable ? <><DropdownMenuItem onSelect={() => setRenameOpen(true)}><PencilIcon />Rename</DropdownMenuItem><DropdownMenuItem onSelect={() => setMoveOpen(true)}><MoveIcon />Move</DropdownMenuItem></> : null}
          {syncable ? <>{editable ? <DropdownMenuSeparator /> : null}{syncPair ? <><DropdownMenuItem disabled={sync.runtimes[syncPair.id]?.status === "syncing"} onSelect={() => void sync.runPair(syncPair.id).catch(() => undefined)}><RefreshCwIcon />Sync now</DropdownMenuItem><DropdownMenuItem disabled={sync.runtimes[syncPair.id]?.status === "syncing"} onSelect={() => void sync.updatePair(syncPair.id, { enabled: !syncPair.enabled }).catch(() => undefined)}>{syncPair.enabled ? <PauseIcon /> : <PlayIcon />}{syncPair.enabled ? "Pause" : "Resume"}</DropdownMenuItem><DropdownMenuItem onSelect={() => void sync.openLocalPath(syncPair.localPath).catch(() => undefined)}><FolderOpenIcon />Open local folder</DropdownMenuItem><DropdownMenuItem onSelect={() => setSyncOpen(true)}><Settings2Icon />Settings</DropdownMenuItem></> : <DropdownMenuItem onSelect={() => setSyncOpen(true)}><FolderSyncIcon />Sync</DropdownMenuItem>}</> : null}
          {full && node.kind === "folder" ? <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setAccessOpen(true)}><Share2Icon />Manage access</DropdownMenuItem></> : null}
          {full ? <DropdownMenuItem onSelect={() => setPublicShareOpen(true)}><Globe2Icon />Public link</DropdownMenuItem> : null}
          {node.canFavorite ? <>{editable || syncable || full ? <DropdownMenuSeparator /> : null}<DropdownMenuItem disabled={favoritePending} onSelect={() => void onFavorite(node, !node.isFavorite)}>{favoritePending ? <Loader2Icon className="animate-spin" /> : node.isFavorite ? <StarOffIcon /> : <StarIcon />}{node.isFavorite ? "Remove from favorites" : "Add to favorites"}</DropdownMenuItem></> : null}
          {editable ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setTrashOpen(true)}><Trash2Icon />Move to trash</DropdownMenuItem></> : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {renameOpen ? <DesktopRenameNodeDialog node={node} open onOpenChange={setRenameOpen} onRenamed={onReload} /> : null}
      {moveOpen ? <DesktopMoveNodesDialog nodes={[node]} folder={folder} breadcrumbs={breadcrumbs} initialPage={page} open onOpenChange={setMoveOpen} onMoved={onReload} /> : null}
      {trashOpen ? <DesktopTrashNodesDialog nodes={[node]} open onOpenChange={setTrashOpen} onTrashed={onReload} /> : null}
      {syncable && syncOpen ? <DesktopSyncPairDialog pair={syncPair} remoteFolder={{ id: node.id, name: node.name, accessLevel: node.accessLevel }} open onOpenChange={setSyncOpen} /> : null}
      {full && node.kind === "folder" ? <DesktopAccessDialog resource={{ type: "folder", id: node.id, name: node.name }} open={accessOpen} onOpenChange={setAccessOpen} trigger={null} /> : null}
      {full ? <DesktopPublicShareDialog resourceType={node.kind} resourceId={node.id} resourceName={node.name} open={publicShareOpen} onOpenChange={setPublicShareOpen} trigger={null} /> : null}
    </>
  )
}

export function DesktopNodeContextMenu({ node, targets, children, favoritePending, onReload, onOpen, onDownload, onMove, onTrash, onFavoriteMany }: NodeContextMenuProps) {
  const sync = useDesktopSync()
  const [renameOpen, setRenameOpen] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [publicShareOpen, setPublicShareOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const single = targets.length === 1
  const editable = targets.length > 0 && targets.every((item) => item.accessLevel !== "view")
  const sameOwner = targets.length > 0 && targets.every((item) => item.ownerUserId === targets[0].ownerUserId)
  const canMove = editable && sameOwner
  const canTrash = editable
  const canFavorite = targets.some((item) => item.canFavorite && !item.isFavorite)
  const canUnfavorite = targets.some((item) => item.canFavorite && item.isFavorite)
  const full = single && node.accessLevel === "full"
  const syncable = single && node.kind === "folder"
  const syncPair = syncable ? sync.pairs.find((pair) => pair.remoteFolderId === node.id) : undefined

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild onContextMenu={(event) => event.stopPropagation()}>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {!single ? <ContextMenuLabel>{targets.length} selected</ContextMenuLabel> : null}
          {single ? <><ContextMenuItem onSelect={() => onOpen(node)}><FolderOpenIcon />Open</ContextMenuItem><ContextMenuItem onSelect={() => void onDownload(node)}><DownloadIcon />Download</ContextMenuItem><ContextMenuSeparator /></> : null}
          {single && editable ? <ContextMenuItem onSelect={() => setRenameOpen(true)}><PencilIcon />Rename</ContextMenuItem> : null}
          {canMove ? <ContextMenuItem onSelect={() => onMove(targets)}><MoveIcon />{single ? "Move" : `Move ${targets.length} items`}</ContextMenuItem> : null}
          {syncable ? syncPair ? <><ContextMenuItem disabled={sync.runtimes[syncPair.id]?.status === "syncing"} onSelect={() => void sync.runPair(syncPair.id).catch(() => undefined)}><RefreshCwIcon />Sync now</ContextMenuItem><ContextMenuItem disabled={sync.runtimes[syncPair.id]?.status === "syncing"} onSelect={() => void sync.updatePair(syncPair.id, { enabled: !syncPair.enabled }).catch(() => undefined)}>{syncPair.enabled ? <PauseIcon /> : <PlayIcon />}{syncPair.enabled ? "Pause" : "Resume"}</ContextMenuItem><ContextMenuItem onSelect={() => void sync.openLocalPath(syncPair.localPath).catch(() => undefined)}><FolderOpenIcon />Open local folder</ContextMenuItem><ContextMenuItem onSelect={() => setSyncOpen(true)}><Settings2Icon />Settings</ContextMenuItem></> : <ContextMenuItem onSelect={() => setSyncOpen(true)}><FolderSyncIcon />Sync</ContextMenuItem> : null}
          {full && node.kind === "folder" ? <ContextMenuItem onSelect={() => setAccessOpen(true)}><Share2Icon />Manage access</ContextMenuItem> : null}
          {full ? <ContextMenuItem onSelect={() => setPublicShareOpen(true)}><Globe2Icon />Public link</ContextMenuItem> : null}
          {(single && editable || canMove || syncable || full) && (canFavorite || canUnfavorite) ? <ContextMenuSeparator /> : null}
          {canFavorite ? <ContextMenuItem disabled={favoritePending} onSelect={() => void onFavoriteMany(targets, true)}><StarIcon />{single ? "Add to favorites" : "Add selected to favorites"}</ContextMenuItem> : null}
          {canUnfavorite ? <ContextMenuItem disabled={favoritePending} onSelect={() => void onFavoriteMany(targets, false)}><StarOffIcon />{single ? "Remove from favorites" : "Remove selected from favorites"}</ContextMenuItem> : null}
          {canTrash ? <><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => onTrash(targets)}><Trash2Icon />{single ? "Move to trash" : `Move ${targets.length} items to trash`}</ContextMenuItem></> : null}
        </ContextMenuContent>
      </ContextMenu>

      {single && renameOpen ? <DesktopRenameNodeDialog node={node} open onOpenChange={setRenameOpen} onRenamed={onReload} /> : null}
      {syncable && syncOpen ? <DesktopSyncPairDialog pair={syncPair} remoteFolder={{ id: node.id, name: node.name, accessLevel: node.accessLevel }} open onOpenChange={setSyncOpen} /> : null}
      {full && node.kind === "folder" ? <DesktopAccessDialog resource={{ type: "folder", id: node.id, name: node.name }} open={accessOpen} onOpenChange={setAccessOpen} trigger={null} /> : null}
      {full ? <DesktopPublicShareDialog resourceType={node.kind} resourceId={node.id} resourceName={node.name} open={publicShareOpen} onOpenChange={setPublicShareOpen} trigger={null} /> : null}
    </>
  )
}
