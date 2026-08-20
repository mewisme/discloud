import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AdminView } from "@/components/admin/admin-view"
import type { AdminUsers, ListUsersQuery, StorageOverview, User } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"

export const metadata: Metadata = {
  title: "Admin",
}

export default async function AdminPage() {
  const user = await apiServerAuthJSON<User>("/auth/me")
  if (user.role !== "admin") redirect("/files")

  const query = { limit: 50, offset: 0 } satisfies ListUsersQuery
  const [users, storage] = await Promise.all([
    apiServerAuthJSON<AdminUsers>("/admin/users", { query }),
    apiServerAuthJSON<StorageOverview>("/admin/storage"),
  ])

  return <AdminView initialUsers={users} initialStorage={storage} currentUserId={user.id} />
}