import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PublicShareView } from "@/components/shares/public-share-view"
import type { PublicShare } from "@/lib/api/models"
import { apiServerJSON } from "@/lib/api/server"
import { APIError } from "@/lib/api/types"
import { publicSharePath } from "@/lib/shares/public"

export const metadata: Metadata = {
  title: "Public share",
  robots: { index: false, follow: false },
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