import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CollectionDetail } from "@/components/collections/collection-detail"
import { apiServerAuthJSON } from "@/lib/api/server"
import type { Collection, CollectionItems } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"

export const metadata: Metadata = {
  title: "Collection",
}

export default async function CollectionPage({ params }: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params
  const data = await loadCollection(collectionId)
  return <CollectionDetail initialCollection={data.collection} initialItems={data.items.items} />
}

async function loadCollection(collectionId: string) {
  try {
    const [collection, items] = await Promise.all([
      apiServerAuthJSON<Collection>(`/api/v1/collections/${collectionId}`),
      apiServerAuthJSON<CollectionItems>(`/api/v1/collections/${collectionId}/items`),
    ])
    return { collection, items }
  } catch (error) {
    if (error instanceof APIError && [403, 404].includes(error.status)) notFound()
    throw error
  }
}