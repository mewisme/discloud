import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CollectionFileDetail } from "@/components/collections/collection-file-detail"
import { apiServerAuthJSON } from "@/lib/api/server"
import type { Collection, CollectionItems } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"

export const metadata: Metadata = {
  title: "File",
}

export default async function CollectionFilePage({ params }: { params: Promise<{ collectionId: string; fileId: string }> }) {
  const { collectionId, fileId } = await params
  const data = await loadCollectionFile(collectionId, fileId)
  return <CollectionFileDetail collection={data.collection} item={data.item} />
}

async function loadCollectionFile(collectionId: string, fileId: string) {
  try {
    const [collection, items] = await Promise.all([
      apiServerAuthJSON<Collection>(`/api/v1/collections/${collectionId}`),
      apiServerAuthJSON<CollectionItems>(`/api/v1/collections/${collectionId}/items`),
    ])
    const item = items.items.find((candidate) => candidate.fileId === fileId)
    if (!item) notFound()
    return { collection, item }
  } catch (error) {
    if (error instanceof APIError && [403, 404].includes(error.status)) notFound()
    throw error
  }
}