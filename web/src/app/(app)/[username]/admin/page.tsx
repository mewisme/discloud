import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AdminView } from "@/components/admin/admin-view"
import type { AdminUsers, ListUsersQuery, StorageOverview, User } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"
import { workspacePath } from "@/lib/workspace/navigation"

export const metadata: Metadata = {
  title: "Admin",
}

export default async function AdminPage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const user = await apiServerAuthJSON<User>("/auth/me")

  if (user.role !== "admin") redirect(workspacePath(username))

  const query = { limit: 50, offset: 0 } satisfies ListUsersQuery

  const [users, storage] = await Promise.all([
    apiServerAuthJSON<AdminUsers>("/admin/users", { query }),
    apiServerAuthJSON<StorageOverview>("/admin/storage"),
  ])

  return <AdminView initialUsers={users} initialStorage={storage} currentUserId={user.id} />
}