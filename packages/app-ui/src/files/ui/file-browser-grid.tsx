"use client"

import type { BrowserNode } from "@discloud/api/models"
import { handleClientNavigation, isInteractiveTarget } from "@discloud/shared/dom"
import { Checkbox } from "@discloud/ui/components/checkbox"
import { FolderUpIcon, StarIcon } from "lucide-react"
import { Fragment } from "react"
import { browserNodeSizeLabel, browserNodeType, type FileBrowserViewProps } from "../core/file-browser"
import { FileNodeVisual } from "./file-node-visual"

export function FileBrowserGrid(props: FileBrowserViewProps) {
  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {props.parent ? (
        <a
          className="group min-w-0 overflow-hidden rounded-xl border bg-card text-left transition-colors hover:bg-muted/40"
          href={props.folderHref(props.parent.id, props.parent.isRoot)}
          onClick={(event) => handleClientNavigation(event, () => props.onNavigateFolder(props.parent!.id, props.parent!.isRoot))}
        >
          <div className="grid aspect-[4/3] w-full place-items-center bg-muted/40">
            <FolderUpIcon className="size-8 text-muted-foreground" />
          </div>
          <div className="p-3">
            <p className="truncate text-sm font-medium">..</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">Parent folder</p>
          </div>
        </a>
      ) : null}

      {props.nodes.map((node) => {
        const selected = props.selection?.selected.has(node.id) ?? false
        const content = (
          <div
            className="group min-w-0 overflow-hidden rounded-xl border bg-card transition-[background-color,box-shadow] hover:bg-muted/20 data-[selected=true]:ring-2 data-[selected=true]:ring-primary/40"
            data-selected={selected || undefined}
            onDoubleClick={(event) => {
              if (isInteractiveTarget(event.target)) return
              if (node.kind === "folder") props.onNavigateFolder(node.id, node.isRoot)
              else props.onOpenFile(node.id)
            }}
          >
            <div className="relative">
              {props.renderNodeVisual
                ? props.renderNodeVisual(node, "aspect-[4/3] w-full rounded-none bg-muted/30", "size-8")
                : <FileNodeVisual node={node} className="aspect-[4/3] w-full rounded-none bg-muted/30" iconClassName="size-8" />}

              {props.selection ? (
                <Checkbox
                  className="absolute left-2 top-2 bg-background/90 shadow-sm"
                  checked={selected}
                  aria-label={`Select ${node.name}`}
                  onCheckedChange={(value) => props.selection?.onSelect(node.id, value === true)}
                />
              ) : null}

              {props.renderNodeActions ? (
                <div className="absolute right-2 top-2 rounded-md bg-background/90 shadow-sm backdrop-blur">
                  {props.renderNodeActions(node)}
                </div>
              ) : null}
            </div>

            <div className="min-w-0 p-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <a
                  className="block min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                  href={node.kind === "folder" ? props.folderHref(node.id, node.isRoot) : props.fileHref(node.id)}
                  onClick={(event) => handleClientNavigation(event, () => node.kind === "folder" ? props.onNavigateFolder(node.id, node.isRoot) : props.onOpenFile(node.id))}
                >
                  {node.name}
                </a>

                {node.isFavorite ? <StarIcon className="size-3 shrink-0 fill-current text-muted-foreground" aria-label="Favorite" /> : null}
              </div>

              <p className="mt-1 truncate text-xs text-muted-foreground">{browserNodeType(node)} · {browserNodeSizeLabel(node)}</p>
            </div>
          </div>
        )

        return <Fragment key={node.id}>{props.wrapNode ? props.wrapNode(node, content) : content}</Fragment>
      })}
    </div>
  )
}