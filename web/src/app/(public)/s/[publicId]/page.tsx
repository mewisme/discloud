import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PublicShareView } from "@/components/shares/public-share-view"
import { apiServerJSON } from "@/lib/api/server"
import type { PublicShare } from "@/lib/api/models"
import { publicSharePath } from "@/lib/shares/public"
import { APIError } from "@/lib/api/types"

export const metadata: Metadata = {
  title: "Public share",
}

export default async function PublicSharePage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const share = await loadShare(publicId)
  return <PublicShareView share={share} />
}

async function loadShare(publicId: string) {
  try {
    return await apiServerJSON<PublicShare>(publicSharePath(publicId))
  } catch (error) {
    if (error instanceof APIError && error.status === 404) notFound()
    throw error
  }
}