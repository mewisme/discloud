"use client"

import type { ReactElement } from "react"
import { useState } from "react"
import { DownloadIcon, FolderOpenIcon, Globe2Icon, MoveIcon, PencilIcon, StarIcon, StarOffIcon, Trash2Icon } from "lucide-react"
import { RenameNodeDialog } from "@/components/files/node-actions"
import { PublicShareDialog } from "@/components/shares/public-share-dialog"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import type { BrowserNode } from "@/lib/api/models"

export function FileNodeContextMenu({
  node,
  targets,
  children,
  favoritePending,
  onOpen,
  onMove,
  onTrash,
  onFavorite,
  onReload,
}: {
  node: BrowserNode
  targets: readonly BrowserNode[]
  children: ReactElement
  favoritePending: boolean
  onOpen: (node: BrowserNode) => void
  onMove: (nodes: readonly BrowserNode[]) => void
  onTrash: (nodes: readonly BrowserNode[]) => void
  onFavorite: (nodes: readonly BrowserNode[], favorite: boolean) => Promise<void>
  onReload: () => Promise<void>
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [publicShareOpen, setPublicShareOpen] = useState(false)
  const single = targets.length === 1
  const editable = targets.length > 0 && targets.every((item) => item.accessLevel !== "view")
  const sameOwner = targets.length > 0 && targets.every((item) => item.ownerUserId === targets[0].ownerUserId)
  const canMove = editable && sameOwner
  const canTrash = editable
  const canFavorite = targets.some((item) => item.canFavorite && !item.isFavorite)
  const canUnfavorite = targets.some((item) => item.canFavorite && item.isFavorite)
  const canPublicShare = single && node.accessLevel === "full"

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>

        <ContextMenuContent className="w-56">
          {!single && <ContextMenuLabel>{targets.length} selected</ContextMenuLabel>}

          {single && (
            <>
              <ContextMenuItem onSelect={() => onOpen(node)}>
                <FolderOpenIcon />
                Open
              </ContextMenuItem>

              {node.kind === "file" && (
                <ContextMenuItem asChild>
                  <a href={`/api/backend/api/v1/files/${encodeURIComponent(node.id)}/download`}>
                    <DownloadIcon />
                    Download
                  </a>
                </ContextMenuItem>
              )}

              <ContextMenuSeparator />
            </>
          )}

          {single && editable && (
            <ContextMenuItem onSelect={() => setRenameOpen(true)}>
              <PencilIcon />
              Rename
            </ContextMenuItem>
          )}

          {canMove && (
            <ContextMenuItem onSelect={() => onMove(targets)}>
              <MoveIcon />
              {single ? "Move" : `Move ${targets.length} items`}
            </ContextMenuItem>
          )}

          {canPublicShare && (
            <ContextMenuItem onSelect={() => setPublicShareOpen(true)}>
              <Globe2Icon />
              Public link
            </ContextMenuItem>
          )}

          {(single && editable || canMove || canPublicShare) && (canFavorite || canUnfavorite) && <ContextMenuSeparator />}

          {canFavorite && (
            <ContextMenuItem disabled={favoritePending} onSelect={() => void onFavorite(targets, true)}>
              <StarIcon />
              {single ? "Add to favorites" : "Add selected to favorites"}
            </ContextMenuItem>
          )}

          {canUnfavorite && (
            <ContextMenuItem disabled={favoritePending} onSelect={() => void onFavorite(targets, false)}>
              <StarOffIcon />
              {single ? "Remove from favorites" : "Remove selected from favorites"}
            </ContextMenuItem>
          )}

          {canTrash && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => onTrash(targets)}>
                <Trash2Icon />
                {single ? "Move to trash" : `Move ${targets.length} items to trash`}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {single && renameOpen && (
        <RenameNodeDialog
          node={node}
          open
          onOpenChange={setRenameOpen}
          onReload={onReload}
        />
      )}

      {canPublicShare && (
        <PublicShareDialog
          resourceType={node.kind}
          resourceId={node.id}
          resourceName={node.name}
          open={publicShareOpen}
          onOpenChange={setPublicShareOpen}
          trigger={null}
        />
      )}
    </>
  )
}