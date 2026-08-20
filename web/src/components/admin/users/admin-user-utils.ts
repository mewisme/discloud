import { apiJSON } from "@/lib/api/client"
import type { AdminUser } from "@/lib/api/models"

const gib = 1024 ** 3

export type AdminRole = AdminUser["role"]

export function adminUserLabel(user: Pick<AdminUser, "name" | "username">) {
  return `${user.name} (@${user.username})`
}

export function getAdminUser(userId: string) {
  return apiJSON<AdminUser>(`/admin/users/${encodeURIComponent(userId)}`)
}

export function parseQuotaGiB(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const amount = Number(trimmed)
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Quota must be a non-negative number")

  const bytes = Math.round(amount * gib)
  if (!Number.isSafeInteger(bytes)) throw new Error("Quota is too large")
  return bytes
}

export function formatQuotaGiB(bytes: number | null) {
  if (bytes === null) return ""
  const value = bytes / gib
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "")
}