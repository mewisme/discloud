import "server-only"

import type { User } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"
import { APIError } from "@/lib/api/types"
import { workspacePath } from "@/lib/files/navigation"

export async function getCurrentUser(): Promise<User | null> {
  try {
    return await apiServerAuthJSON<User>("/api/v1/auth/me")
  } catch (error) {
    if (error instanceof APIError && error.status === 401) return null
    throw error
  }
}

export function authenticatedPath(user: Pick<User, "mustChangePassword" | "username">) {
  return user.mustChangePassword ? "/change-password" : workspacePath(user.username)
}