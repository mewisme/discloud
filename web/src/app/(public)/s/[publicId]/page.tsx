import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PublicShareShell, UnavailablePublicShare } from "@/components/shares/public/public-share-shell"
import { PublicShareUnlock } from "@/components/shares/public/public-share-unlock"
import { PublicShareView } from "@/components/shares/public-share-view"
import type { PublicShare } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"
import { APIError } from "@/lib/api/types"
import { publicSharePath } from "@/lib/shares/public"

export const metadata: Metadata = {
  title: "Public share",
  robots: { index: false, follow: false },
}

export default async function PublicSharePage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const result = await loadShare(publicId)
  if (result === "locked") return <PublicShareUnlock publicId={publicId} />
  if (result === "unavailable") return <PublicShareShell><UnavailablePublicShare message="This public link has expired or reached its view limit." /></PublicShareShell>
  return <PublicShareView share={result} />
}

async function loadShare(publicId: string) {
  try {
    return await apiServerAuthJSON<PublicShare>(publicSharePath(publicId))
  } catch (error) {
    if (error instanceof APIError && error.status === 404) notFound()
    if (error instanceof APIError && error.status === 401) return "locked" as const
    if (error instanceof APIError && error.status === 410) return "unavailable" as const
    throw error
  }
}