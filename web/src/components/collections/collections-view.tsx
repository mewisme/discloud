"use client"

import { CollectionsView as CollectionsPresentation } from "@discloud/app-ui/collections/collections-view"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import { useWorkspace } from "@/components/app/workspace-context"
import { CreateCollectionDialog } from "@/components/collections/create-collection-dialog"
import { DateOnly } from "@/components/common/date-time"
import { PaginationTrigger } from "@/components/common/pagination-trigger"
import { apiJSON } from "@/lib/api/client"
import type { Collection, CollectionPage, CollectionsQuery } from "@/lib/api/models"
import { collectionPath } from "@/lib/files/navigation"
import { apiErrorMessage } from "@/lib/helpers"

export function CollectionsView({ initialPage }: { initialPage: CollectionPage }) {
  const workspace = useWorkspace(); const [collections, setCollections] = useState<Collection[]>(() => [...initialPage.collections]); const [nextCursor, setNextCursor] = useState(initialPage.nextCursor); const [loadingMore, setLoadingMore] = useState(false)
  function created(collection: Collection) { setCollections((current) => [...current, collection].sort((a, b) => a.name.localeCompare(b.name))) }
  async function loadMore() { if (!nextCursor || loadingMore) return; setLoadingMore(true); try { const query = { ownerId: workspace.id, limit: 50, cursor: nextCursor } satisfies CollectionsQuery; const page = await apiJSON<CollectionPage>("/api/v1/collections", { query }); setCollections((current) => [...current, ...page.collections]); setNextCursor(page.nextCursor) } catch (error) { toast.error(apiErrorMessage(error, "Could not load more collections")); throw error } finally { setLoadingMore(false) } }
  return <CollectionsPresentation username={workspace.username} collections={collections} action={<CreateCollectionDialog onCreated={created} />} renderLink={(collection, className, children) => <Link href={collectionPath(workspace.username, collection.id)} className={className}>{children}</Link>} renderUpdated={(collection) => <DateOnly value={collection.updatedAt} />} pagination={nextCursor ? <PaginationTrigger loadKey={nextCursor} hasMore loading={loadingMore} onLoadMore={loadMore} loadingLabel="Loading more collections…" /> : null} />
}
