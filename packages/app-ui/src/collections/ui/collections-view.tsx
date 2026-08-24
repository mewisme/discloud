"use client"

import type { Collection } from "@discloud/api/models"
import { formatDate } from "@discloud/shared/format"
import { Badge } from "@discloud/ui/components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { FolderHeartIcon } from "lucide-react"
import { Fragment, type ReactNode } from "react"

export type CollectionLinkRenderer = (collection: Collection, className: string, children: ReactNode) => ReactNode

export function CollectionsView({ username, collections, action, pagination, renderLink, renderUpdated }: { username: string; collections: readonly Collection[]; action?: ReactNode; pagination?: ReactNode; renderLink: CollectionLinkRenderer; renderUpdated?: (collection: Collection) => ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><h1 className="text-2xl font-semibold tracking-tight">Collections</h1><p className="text-sm text-muted-foreground">Collections owned by @{username}.</p></div>
        {action}
      </div>
      {collections.length === 0 ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div className="space-y-3"><FolderHeartIcon className="mx-auto size-10 text-muted-foreground" /><div><p className="font-medium">No collections yet</p><p className="text-sm text-muted-foreground">Create one to group related files.</p></div></div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {collections.map((collection) => (
            <Fragment key={collection.id}>{renderLink(collection, "group", (
              <Card className="h-full transition-colors group-hover:bg-muted/40">
                <CardHeader><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate text-base">{collection.name}</CardTitle><CardDescription className="mt-1 line-clamp-2">{collection.description || "No description"}</CardDescription></div><Badge variant="secondary" className="capitalize">{collection.accessLevel}</Badge></div></CardHeader>
                <CardContent className="text-xs text-muted-foreground">Updated {renderUpdated ? renderUpdated(collection) : formatDate(collection.updatedAt)}</CardContent>
              </Card>
            ))}</Fragment>
          ))}
        </div>
      )}
      {pagination}
    </div>
  )
}
