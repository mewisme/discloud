"use client"

import { Globe2Icon, Loader2Icon, MoreHorizontalIcon, MoveIcon, PencilIcon, StarIcon, StarOffIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { MoveNodesDialog } from "@/components/files/actions/move-nodes-dialog"
import { RenameNodeDialog } from "@/components/files/actions/rename-node-dialog"
import { TrashNodesDialog } from "@/components/files/actions/trash-nodes-dialog"
import { PublicShareDialog } from "@/components/shares/public-share-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { BrowserNode, Node, NodePage } from "@/lib/api/models"
import type { BrowserOptions } from "@/lib/files/browser"

export function NodeActionsMenu({
  node,
  folder,
  breadcrumbs,
  page,
  options,
  onReload,
  onMoved,
  onFavorite,
}: {
  node: BrowserNode
  folder: Node
  breadcrumbs: readonly Node[]
  page: NodePage
  options: BrowserOptions
  onReload: () => Promise<void>
  onMoved: (nodeId: string) => void
  onFavorite: (node: BrowserNode, favorite: boolean) => Promise<void>
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [publicShareOpen, setPublicShareOpen] = useState(false)
  const [favoritePending, setFavoritePending] = useState(false)
  const editable = node.accessLevel !== "view"
  const canPublicShare = node.accessLevel === "full"

  if (!editable && !node.canFavorite && !canPublicShare) return null

  async function favorite() {
    setFavoritePending(true)

    try {
      await onFavorite(node, !node.isFavorite)
    } finally {
      setFavoritePending(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${node.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-48">
          {editable && (
            <>
              <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                <PencilIcon />
                Rename
              </DropdownMenuItem>

              <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                <MoveIcon />
                Move
              </DropdownMenuItem>
            </>
          )}

          {canPublicShare && (
            <>
              {editable && <DropdownMenuSeparator />}

              <DropdownMenuItem onSelect={() => setPublicShareOpen(true)}>
                <Globe2Icon />
                Public link
              </DropdownMenuItem>
            </>
          )}

          {(editable || canPublicShare) && node.canFavorite && <DropdownMenuSeparator />}

          {node.canFavorite && (
            <DropdownMenuItem disabled={favoritePending} onSelect={() => void favorite()}>
              {favoritePending ? <Loader2Icon className="animate-spin" /> : node.isFavorite ? <StarOffIcon /> : <StarIcon />}
              {node.isFavorite ? "Remove from favorites" : "Add to favorites"}
            </DropdownMenuItem>
          )}

          {editable && (
            <>
              <DropdownMenuSeparator />

              <DropdownMenuItem variant="destructive" onSelect={() => setTrashOpen(true)}>
                <Trash2Icon />
                Move to trash
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {renameOpen && (
        <RenameNodeDialog
          node={node}
          open
          onOpenChange={setRenameOpen}
          onReload={onReload}
        />
      )}

      {moveOpen && (
        <MoveNodesDialog
          nodes={[node]}
          folder={folder}
          breadcrumbs={breadcrumbs}
          initialPage={page}
          options={options}
          open
          onOpenChange={setMoveOpen}
          onMoved={(nodeIds) => nodeIds.forEach(onMoved)}
        />
      )}

      {trashOpen && (
        <TrashNodesDialog
          nodes={[node]}
          open
          onOpenChange={setTrashOpen}
          onTrashed={async () => {
            try {
              await onReload()
            } catch {
              toast.error("Moved to trash, but the browser could not refresh")
            }
          }}
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