"use client"

import type { Node } from "@discloud/api/models"
import type { ReactNode } from "react"
import { FileBreadcrumbs, type FileBreadcrumbItem } from "./file-breadcrumbs"

export type FileBrowserBreadcrumbItem = FileBreadcrumbItem

export function FileBrowserHeader({
  folder,
  breadcrumbs,
  itemCount,
  hasMore,
  actions,
  onNavigate,
}: {
  folder: Node
  breadcrumbs: readonly FileBrowserBreadcrumbItem[]
  itemCount: number
  hasMore: boolean
  actions?: ReactNode
  onNavigate?: (item: FileBrowserBreadcrumbItem) => void
}) {
  return (
    <>
      <FileBreadcrumbs items={breadcrumbs} onNavigate={onNavigate} />

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{folder.isRoot ? "Files" : folder.name}</h1>
          <p className="text-sm text-muted-foreground">{itemCount}{hasMore ? "+" : ""} items</p>
        </div>
        {actions}
      </div>
    </>
  )
}