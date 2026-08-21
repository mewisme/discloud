import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AdminBotsView } from "@/components/admin/bots/admin-bots-view"
import type { BotRuntimeSnapshot, User } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"
import { workspacePath } from "@/lib/workspace/navigation"

export const metadata: Metadata = {
  title: "Bots",
}

export default async function AdminBotsPage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const user = await apiServerAuthJSON<User>("/auth/me")

  if (user.role !== "admin") redirect(workspacePath(username))

  const snapshot = await apiServerAuthJSON<BotRuntimeSnapshot>("/admin/bots")
  return <AdminBotsView initialSnapshot={snapshot} />
}