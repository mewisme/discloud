"use client"

import { FolderUpIcon, StarIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { useWorkspace } from "@/components/app/workspace-context"
import { DateOnly } from "@/components/common/date-time"
import { NodeActionsMenu } from "@/components/files/actions/node-actions-menu"
import { browserContextTargets, type BrowserItemsViewProps, browserNodeType } from "@/components/files/browser/file-browser-item-shared"
import { FileNodeContextMenu } from "@/components/files/file-node-context-menu"
import { FileNodeVisual } from "@/components/files/file-node-visual"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { BrowserNode } from "@/lib/api/models"
import { fileBrowserPath, folderBrowserURL } from "@/lib/files/navigation"
import { formatBytes, handleClientNavigation, isInteractiveTarget } from "@/lib/helpers"

export function FileBrowserList(props: BrowserItemsViewProps) {
  const router = useRouter()
  const workspace = useWorkspace()
  const allSelected = props.nodes.length > 0 && props.nodes.every((node) => props.selected.has(node.id))
  const someSelected = props.nodes.some((node) => props.selected.has(node.id))

  function open(node: BrowserNode) {
    if (node.kind === "folder") props.onNavigate(node.id)
    else router.push(fileBrowserPath(workspace.username, node.id))
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                aria-label="Select all loaded items"
                onCheckedChange={(value) => props.onSelectAll(value === true)}
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Type</TableHead>
            <TableHead className="hidden w-28 sm:table-cell">Size</TableHead>
            <TableHead className="hidden w-36 lg:table-cell">Modified</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>

        <TableBody>
          {props.parent && (
            <TableRow className="select-none">
              <TableCell />
              <TableCell>
                <a
                  className="flex items-center gap-2 font-medium hover:underline"
                  href={folderBrowserURL(workspace.username, props.parent.isRoot ? undefined : props.parent.id, props.options)}
                  onClick={(event) => handleClientNavigation(event, () => props.onNavigate(props.parent!.id))}
                >
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                    <FolderUpIcon className="size-4 text-muted-foreground" />
                  </div>
                  <span>..</span>
                </a>
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">Parent folder</TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden lg:table-cell" />
              <TableCell />
            </TableRow>
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
              <TableRow
                className="select-none"
                data-state={props.selected.has(node.id) ? "selected" : undefined}
                onDoubleClick={(event) => {
                  if (!isInteractiveTarget(event.target)) open(node)
                }}
              >
                <TableCell>
                  <Checkbox
                    checked={props.selected.has(node.id)}
                    aria-label={`Select ${node.name}`}
                    onCheckedChange={(value) => props.onSelect(node.id, value === true)}
                  />
                </TableCell>

                <TableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    <FileNodeVisual node={node} className="size-9" iconClassName="size-4" />

                    {node.kind === "folder" ? (
                      <a
                        className="truncate font-medium hover:underline"
                        href={folderBrowserURL(workspace.username, node.id, props.options)}
                        onClick={(event) => handleClientNavigation(event, () => props.onNavigate(node.id))}
                      >
                        {node.name}
                      </a>
                    ) : (
                      <Link className="truncate font-medium hover:underline" href={fileBrowserPath(workspace.username, node.id)}>
                        {node.name}
                      </Link>
                    )}

                    {node.isFavorite && <StarIcon className="size-3.5 shrink-0 fill-current text-muted-foreground" aria-label="Favorite" />}
                  </div>
                </TableCell>

                <TableCell className="hidden text-muted-foreground md:table-cell">{browserNodeType(node)}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{node.size != null ? formatBytes(node.size) : "—"}</TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell" title={node.updatedAt}>
                  <DateOnly value={node.updatedAt} />
                </TableCell>

                <TableCell>
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
                </TableCell>
              </TableRow>
            </FileNodeContextMenu>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}