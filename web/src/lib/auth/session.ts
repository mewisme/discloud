import "server-only"
import { apiServerAuthJSON } from "@/lib/api/server"
import type { User } from "@/lib/api/models"
import { APIError } from "@/lib/api/types"

export async function getCurrentUser(): Promise<User | null> {
  try {
    return await apiServerAuthJSON<User>("/api/v1/auth/me")
  } catch (error) {
    if (error instanceof APIError && error.status === 401) return null
    throw error
  }
}

export function authenticatedPath(user: Pick<User, "mustChangePassword">) {
  return user.mustChangePassword ? "/change-password" : "/files"
}