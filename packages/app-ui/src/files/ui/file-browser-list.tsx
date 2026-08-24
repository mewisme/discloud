"use client"

import type { BrowserNode } from "@discloud/api/models"
import { handleClientNavigation, isInteractiveTarget } from "@discloud/shared/dom"
import { formatDate } from "@discloud/shared/format"
import { Checkbox } from "@discloud/ui/components/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { FolderUpIcon, StarIcon } from "lucide-react"
import { Fragment } from "react"
import { browserNodeSizeLabel, browserNodeType, type FileBrowserViewProps } from "../core/file-browser"
import { FileNodeVisual } from "./file-node-visual"

export function FileBrowserList(props: FileBrowserViewProps) {
  const allSelected = !!props.selection && props.nodes.length > 0 && props.nodes.every((node) => props.selection!.selected.has(node.id))
  const someSelected = !!props.selection && props.nodes.some((node) => props.selection!.selected.has(node.id))

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-xl border bg-card">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            {props.selection ? (
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  aria-label="Select all loaded items"
                  onCheckedChange={(value) => props.selection?.onSelectAll(value === true)}
                />
              </TableHead>
            ) : null}

            <TableHead>Name</TableHead>
            <TableHead className="hidden w-32 md:table-cell">Type</TableHead>
            <TableHead className="hidden w-28 sm:table-cell">Size</TableHead>
            <TableHead className="hidden w-36 lg:table-cell">Modified</TableHead>
            {props.renderNodeActions ? <TableHead className="w-10" /> : null}
          </TableRow>
        </TableHeader>

        <TableBody>
          {props.parent ? (
            <TableRow className="select-none">
              {props.selection ? <TableCell /> : null}

              <TableCell>
                <a
                  className="flex items-center gap-2 font-medium hover:underline"
                  href={props.folderHref(props.parent.id, props.parent.isRoot)}
                  onClick={(event) => handleClientNavigation(event, () => props.onNavigateFolder(props.parent!.id, props.parent!.isRoot))}
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
              {props.renderNodeActions ? <TableCell /> : null}
            </TableRow>
          ) : null}

          {props.nodes.map((node) => {
            const selected = props.selection?.selected.has(node.id) ?? false
            const content = (
              <TableRow
                className="select-none"
                data-state={selected ? "selected" : undefined}
                onDoubleClick={(event) => {
                  if (isInteractiveTarget(event.target)) return
                  if (node.kind === "folder") props.onNavigateFolder(node.id, node.isRoot)
                  else props.onOpenFile(node.id)
                }}
              >
                {props.selection ? (
                  <TableCell>
                    <Checkbox checked={selected} aria-label={`Select ${node.name}`} onCheckedChange={(value) => props.selection?.onSelect(node.id, value === true)} />
                  </TableCell>
                ) : null}

                <TableCell className="min-w-0 overflow-hidden">
                  <div className="flex w-full min-w-0 items-center gap-2">
                    {props.renderNodeVisual
                      ? props.renderNodeVisual(node, "size-9 shrink-0", "size-4")
                      : <FileNodeVisual node={node} className="size-9 shrink-0" iconClassName="size-4" />}

                    <a
                      className="block min-w-0 flex-1 truncate font-medium hover:underline"
                      title={node.name}
                      href={node.kind === "folder" ? props.folderHref(node.id, node.isRoot) : props.fileHref(node.id)}
                      onClick={(event) => handleClientNavigation(event, () => node.kind === "folder" ? props.onNavigateFolder(node.id, node.isRoot) : props.onOpenFile(node.id))}
                    >
                      {node.name}
                    </a>

                    {node.isFavorite ? <StarIcon className="size-3.5 shrink-0 fill-current text-muted-foreground" aria-label="Favorite" /> : null}
                  </div>
                </TableCell>

                <TableCell className="hidden w-32 truncate text-muted-foreground md:table-cell" title={browserNodeType(node)}>{browserNodeType(node)}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{browserNodeSizeLabel(node)}</TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell" title={node.updatedAt}>
                  {props.renderModified ? props.renderModified(node) : formatDate(node.updatedAt)}
                </TableCell>

                {props.renderNodeActions ? <TableCell>{props.renderNodeActions(node)}</TableCell> : null}
              </TableRow>
            )

            return <Fragment key={node.id}>{props.wrapNode ? props.wrapNode(node, content) : content}</Fragment>
          })}
        </TableBody>
      </Table>
    </div>
  )
}