import "client-only"

import { apiJSON } from "@/lib/api/client"
import type { AdminUser, AdminUsers, ListUsersQuery } from "@/lib/api/models"

const pageSize = 100

export type AdminDirectoryUser = Pick<AdminUser, "id" | "username" | "name" | "role" | "status">

export async function listAdminUserDirectory(signal?: AbortSignal): Promise<AdminDirectoryUser[]> {
  const users = new Map<string, AdminDirectoryUser>()
  let offset = 0

  while (true) {
    const query = { limit: pageSize, offset } satisfies ListUsersQuery
    const page = await apiJSON<AdminUsers>("/admin/users", { query, signal })

    for (const user of page.users) {
      users.set(user.id, {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        status: user.status,
      })
    }

    if (!page.users.length || page.offset + page.users.length >= page.total) break
    offset = page.offset + page.users.length
  }

  return [...users.values()].sort((left, right) => left.name.localeCompare(right.name) || left.username.localeCompare(right.username))
}