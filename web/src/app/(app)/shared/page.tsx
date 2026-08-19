import type { Metadata } from "next"
import { SharedView } from "@/components/shared/shared-view"
import { apiServerAuthJSON } from "@/lib/api/server"
import type { SharedItems } from "@/lib/api/models"

export const metadata: Metadata = {
  title: "Shared",
}

export default async function SharedPage() {
  const data = await apiServerAuthJSON<SharedItems>("/api/v1/shared")
  return <SharedView items={data.items} />
}