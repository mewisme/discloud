import type { Metadata } from "next"

import { SharedView } from "@/components/shared/shared-view"
import type { SharedItems } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"

export const metadata: Metadata = {
  title: "Shared",
}

export default async function SharedPage() {
  const data = await apiServerAuthJSON<SharedItems>("/api/v1/shared")
  return <SharedView items={data.items} />
}