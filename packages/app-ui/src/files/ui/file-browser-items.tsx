"use client"

import { FolderOpenIcon, Loader2Icon } from "lucide-react"
import type { FileBrowserItemsProps } from "../core/file-browser"
import { FileBrowserGrid } from "./file-browser-grid"
import { FileBrowserList } from "./file-browser-list"

export function FileBrowserItems(props: FileBrowserItemsProps) {
  const parent = props.folder.isRoot ? undefined : props.breadcrumbs.at(-2)
  const empty = props.nodes.length === 0 && !parent

  return (
    <div className="relative min-h-24" aria-busy={props.loading}>
      {empty
        ? <EmptyFolder description={props.emptyDescription} />
        : props.view === "grid"
          ? <FileBrowserGrid {...props} parent={parent} />
          : <FileBrowserList {...props} parent={parent} />}

      {props.loading ? (
        <div className="absolute inset-0 z-10 grid min-h-24 place-items-center rounded-xl bg-background/70 backdrop-blur-[1px]">
          <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
            Loading folder…
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function EmptyFolder({ description = "Drop files here or create a folder." }: { description?: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div className="space-y-2">
        <div className="mx-auto grid size-11 place-items-center rounded-xl bg-muted">
          <FolderOpenIcon className="size-5 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">Empty folder</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  )
}