import type { BrowserNode, Node, NodePage } from "@discloud/api/models"
import { Button } from "@discloud/ui/components/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@discloud/ui/components/dropdown-menu"
import { Globe2Icon, Loader2Icon, MoreHorizontalIcon, MoveIcon, PencilIcon, Share2Icon, StarIcon, StarOffIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { DesktopAccessDialog } from "../../access/access-dialog"
import { DesktopPublicShareDialog } from "../../shares/public-share-dialog"
import { DesktopMoveNodesDialog } from "./move-nodes-dialog"
import { DesktopRenameNodeDialog } from "./rename-node-dialog"
import { DesktopTrashNodesDialog } from "./trash-nodes-dialog"

export function DesktopNodeActionsMenu({
  node,
  folder,
  breadcrumbs,
  page,
  favoritePending,
  onReload,
  onFavorite,
}: {
  node: BrowserNode
  folder: Node
  breadcrumbs: readonly Node[]
  page: NodePage
  favoritePending: boolean
  onReload: () => void
  onFavorite: (node: BrowserNode, favorite: boolean) => Promise<void>
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [publicShareOpen, setPublicShareOpen] = useState(false)
  const editable = node.accessLevel !== "view"
  const full = node.accessLevel === "full"

  if (!editable && !node.canFavorite && !full) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${node.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-48">
          {editable ? (
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
          ) : null}

          {full && node.kind === "folder" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setAccessOpen(true)}>
                <Share2Icon />
                Manage access
              </DropdownMenuItem>
            </>
          ) : null}

          {full ? (
            <DropdownMenuItem onSelect={() => setPublicShareOpen(true)}>
              <Globe2Icon />
              Public link
            </DropdownMenuItem>
          ) : null}

          {node.canFavorite ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={favoritePending} onSelect={() => void onFavorite(node, !node.isFavorite)}>
                {favoritePending ? <Loader2Icon className="animate-spin" /> : node.isFavorite ? <StarOffIcon /> : <StarIcon />}
                {node.isFavorite ? "Remove from favorites" : "Add to favorites"}
              </DropdownMenuItem>
            </>
          ) : null}

          {editable ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setTrashOpen(true)}>
                <Trash2Icon />
                Move to trash
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {renameOpen ? (
        <DesktopRenameNodeDialog
          node={node}
          open
          onOpenChange={setRenameOpen}
          onRenamed={onReload}
        />
      ) : null}

      {moveOpen ? (
        <DesktopMoveNodesDialog
          nodes={[node]}
          folder={folder}
          breadcrumbs={breadcrumbs}
          initialPage={page}
          open
          onOpenChange={setMoveOpen}
          onMoved={onReload}
        />
      ) : null}

      {trashOpen ? (
        <DesktopTrashNodesDialog
          nodes={[node]}
          open
          onOpenChange={setTrashOpen}
          onTrashed={onReload}
        />
      ) : null}

      {full && node.kind === "folder" ? (
        <DesktopAccessDialog
          resource={{ type: "folder", id: node.id, name: node.name }}
          open={accessOpen}
          onOpenChange={setAccessOpen}
          trigger={null}
        />
      ) : null}

      {full ? (
        <DesktopPublicShareDialog
          resourceType={node.kind}
          resourceId={node.id}
          resourceName={node.name}
          open={publicShareOpen}
          onOpenChange={setPublicShareOpen}
          trigger={null}
        />
      ) : null}
    </>
  )
}