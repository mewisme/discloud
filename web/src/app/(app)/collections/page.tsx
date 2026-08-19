import type { Metadata } from "next"
import { CollectionsView } from "@/components/collections/collections-view"
import { apiServerAuthJSON } from "@/lib/api/server"
import type { CollectionPage } from "@/lib/api/models"

export const metadata: Metadata = {
  title: "Collections",
}

export default async function CollectionsPage() {
  const page = await apiServerAuthJSON<CollectionPage>("/api/v1/collections", { query: { limit: 50 } })
  return <CollectionsView initialPage={page} />
}