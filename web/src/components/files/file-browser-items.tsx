"use client"

import { EmptyFolder } from "@discloud/app-ui/files/file-browser-items"
import { Loader2Icon } from "lucide-react"

import { FileBrowserGrid } from "@/components/files/browser/file-browser-grid"
import type { BrowserItemsProps } from "@/components/files/browser/file-browser-item-shared"
import { FileBrowserList } from "@/components/files/browser/file-browser-list"

export function BrowserItems(props: BrowserItemsProps) {
  const parent = props.folder.isRoot ? undefined : props.breadcrumbs.at(-2)
  const empty = props.nodes.length === 0 && !parent

  return (
    <div className="relative min-h-24" aria-busy={props.loading}>
      {empty
        ? <EmptyFolder />
        : props.options.view === "grid"
          ? <FileBrowserGrid {...props} parent={parent} />
          : <FileBrowserList {...props} parent={parent} />}

      {props.loading && (
        <div className="absolute inset-0 z-10 grid min-h-24 place-items-center rounded-xl bg-background/70 backdrop-blur-[1px]">
          <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
            Loading folder…
          </div>
        </div>
      )}
    </div>
  )
}