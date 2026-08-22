"use client"

import { FolderUpIcon, StarIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { useWorkspace } from "@/components/app/workspace-context"
import { NodeActionsMenu } from "@/components/files/actions/node-actions-menu"
import { browserContextTargets, type BrowserItemsViewProps, browserNodeSizeLabel, browserNodeType } from "@/components/files/browser/file-browser-item-shared"
import { FileNodeContextMenu } from "@/components/files/file-node-context-menu"
import { FileNodeVisual } from "@/components/files/file-node-visual"
import { Checkbox } from "@/components/ui/checkbox"
import type { BrowserNode } from "@/lib/api/models"
import { fileBrowserPath, folderBrowserURL } from "@/lib/files/navigation"
import { handleClientNavigation, isInteractiveTarget } from "@/lib/helpers"

export function FileBrowserGrid(props: BrowserItemsViewProps) {
  const router = useRouter()
  const workspace = useWorkspace()

  function open(node: BrowserNode) {
    if (node.kind === "folder") props.onNavigate(node.id)
    else router.push(fileBrowserPath(workspace.username, node.id))
  }

  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {props.parent && (
        <button
          type="button"
          className="group min-w-0 overflow-hidden rounded-xl border bg-card text-left transition-colors hover:bg-muted/40"
          onClick={() => props.onNavigate(props.parent!.id)}
        >
          <div className="grid aspect-[4/3] w-full place-items-center bg-muted/40">
            <FolderUpIcon className="size-8 text-muted-foreground" />
          </div>
          <div className="p-3">
            <p className="truncate text-sm font-medium">..</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">Parent folder</p>
          </div>
        </button>
      )}

      {props.nodes.map((node) => (
        <FileNodeContextMenu
          key={node.id}
          node={node}
          targets={browserContextTargets(props, node)}
          favoritePending={props.favoritePending}
          onOpen={open}
          onMove={props.onMoveTargets}
          onTrash={props.onTrashTargets}
          onFavorite={props.onFavoriteTargets}
          onReload={props.onReload}
        >
          <div
            className="group min-w-0 overflow-hidden rounded-xl border bg-card transition-[background-color,box-shadow] hover:bg-muted/20 data-[selected=true]:ring-2 data-[selected=true]:ring-primary/40"
            data-selected={props.selected.has(node.id)}
            onDoubleClick={(event) => {
              if (!isInteractiveTarget(event.target)) open(node)
            }}
          >
            <div className="relative">
              <FileNodeVisual node={node} className="aspect-[4/3] w-full rounded-none bg-muted/30" iconClassName="size-8" />

              <Checkbox
                className="absolute left-2 top-2 bg-background/90 shadow-sm"
                checked={props.selected.has(node.id)}
                aria-label={`Select ${node.name}`}
                onCheckedChange={(value) => props.onSelect(node.id, value === true)}
              />

              <div className="absolute right-2 top-2 rounded-md bg-background/90 shadow-sm backdrop-blur">
                <NodeActionsMenu
                  node={node}
                  folder={props.folder}
                  breadcrumbs={props.breadcrumbs}
                  page={props.page}
                  options={props.options}
                  onReload={props.onReload}
                  onMoved={props.onMoved}
                  onFavorite={props.onFavorite}
                />
              </div>
            </div>

            <div className="min-w-0 p-3">
              <div className="flex min-w-0 items-center gap-1.5">
                {node.kind === "folder" ? (
                  <a
                    className="block min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                    href={folderBrowserURL(workspace.username, node.id, props.options)}
                    onClick={(event) => handleClientNavigation(event, () => props.onNavigate(node.id))}
                  >
                    {node.name}
                  </a>
                ) : (
                  <Link className="block min-w-0 flex-1 truncate text-sm font-medium hover:underline" href={fileBrowserPath(workspace.username, node.id)}>
                    {node.name}
                  </Link>
                )}

                {node.isFavorite && <StarIcon className="size-3 shrink-0 fill-current text-muted-foreground" aria-label="Favorite" />}
              </div>

              <p className="mt-1 truncate text-xs text-muted-foreground">
                {browserNodeType(node)} · {browserNodeSizeLabel(node)}
              </p>
            </div>
          </div>
        </FileNodeContextMenu>
      ))}
    </div>
  )
}