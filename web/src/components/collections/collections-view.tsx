"use client"

import { FolderHeartIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import { useWorkspace } from "@/components/app/workspace-context"
import { CreateCollectionDialog } from "@/components/collections/create-collection-dialog"
import { DateOnly } from "@/components/common/date-time"
import { PaginationTrigger } from "@/components/common/pagination-trigger"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiJSON } from "@/lib/api/client"
import type { Collection, CollectionPage, CollectionsQuery } from "@/lib/api/models"
import { collectionPath } from "@/lib/files/navigation"
import { apiErrorMessage } from "@/lib/helpers"

export function CollectionsView({ initialPage }: { initialPage: CollectionPage }) {
  const workspace = useWorkspace()
  const [collections, setCollections] = useState<Collection[]>(() => [...initialPage.collections])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [loadingMore, setLoadingMore] = useState(false)

  function created(collection: Collection) {
    setCollections((current) => [...current, collection].sort((a, b) => a.name.localeCompare(b.name)))
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)

    try {
      const query = {
        ownerId: workspace.id,
        limit: 50,
        cursor: nextCursor,
      } satisfies CollectionsQuery

      const page = await apiJSON<CollectionPage>("/api/v1/collections", { query })
      setCollections((current) => [...current, ...page.collections])
      setNextCursor(page.nextCursor)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load more collections"))
      throw error
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Collections</h1>
          <p className="text-sm text-muted-foreground">Collections owned by @{workspace.username}.</p>
        </div>

        <CreateCollectionDialog onCreated={created} />
      </div>

      {collections.length === 0 ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div className="space-y-3">
            <FolderHeartIcon className="mx-auto size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No collections yet</p>
              <p className="text-sm text-muted-foreground">Create one to group related files.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {collections.map((collection) => (
            <Link key={collection.id} href={collectionPath(workspace.username, collection.id)} className="group">
              <Card className="h-full transition-colors group-hover:bg-muted/40">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{collection.name}</CardTitle>
                      <CardDescription className="mt-1 line-clamp-2">
                        {collection.description || "No description"}
                      </CardDescription>
                    </div>

                    <Badge variant="secondary" className="capitalize">{collection.accessLevel}</Badge>
                  </div>
                </CardHeader>

                <CardContent className="text-xs text-muted-foreground">
                  Updated <DateOnly value={collection.updatedAt} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {nextCursor && (
        <PaginationTrigger
          loadKey={nextCursor}
          hasMore
          loading={loadingMore}
          onLoadMore={loadMore}
          loadingLabel="Loading more collections…"
        />
      )}
    </div>
  )
}