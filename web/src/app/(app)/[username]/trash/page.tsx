import type { Metadata } from "next"

import { TrashView } from "@/components/trash/trash-view"
import type { TrashPage, TrashQuery } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"
import { getWorkspace } from "@/lib/workspace/server"

export const metadata: Metadata = {
  title: "Trash",
}

export default async function TrashPage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const workspace = await getWorkspace(username)

  const query = {
    limit: 50,
    ownerId: workspace.owner.id,
  } satisfies TrashQuery

  const page = await apiServerAuthJSON<TrashPage>(
    "/api/v1/trash",
    { query },
  )

  return <TrashView initialPage={page} />
}