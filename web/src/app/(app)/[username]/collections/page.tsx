import type { Metadata } from "next"

import { CollectionsView } from "@/components/collections/collections-view"
import type { CollectionPage, CollectionsQuery } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"
import { getWorkspace } from "@/lib/workspace/server"

export const metadata: Metadata = {
  title: "Collections",
}

export default async function CollectionsPage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const workspace = await getWorkspace(username)

  const query = {
    ownerId: workspace.owner.id,
    limit: 50,
  } satisfies CollectionsQuery

  const page = await apiServerAuthJSON<CollectionPage>(
    "/api/v1/collections",
    { query },
  )

  return <CollectionsView initialPage={page} />
}