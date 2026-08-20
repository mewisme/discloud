import type { Metadata } from "next"

import { TrashView } from "@/components/trash/trash-view"
import type { TrashPage, TrashQuery, User } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"

export const metadata: Metadata = {
  title: "Trash",
}

export default async function TrashPage() {
  const user = await apiServerAuthJSON<User>("/api/v1/auth/me")
  const query = { limit: 50, ownerId: user.id } satisfies TrashQuery
  const page = await apiServerAuthJSON<TrashPage>("/api/v1/trash", { query })

  return <TrashView initialPage={page} ownerId={user.id} />
}