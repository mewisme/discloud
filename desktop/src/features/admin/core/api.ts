import type { AdminUser, AdminUsers, AuditPage, AuditQuery, BotRuntimeSnapshot, CreateUserInput, JobPage, JobsQuery, ListUsersQuery, QuotaReconciliationPage, ReconcileQuotaInput, ResetUserPasswordInput, SetUserQuotaInput, StorageOverview, UpdateUserInput, UploadDiagnosticPage, UploadDiagnosticsQuery } from "@discloud/api/models"

import { apiJSON } from "#lib/api/transport"

export function loadAdminUsers(query: ListUsersQuery) {
  return apiJSON<AdminUsers>("/api/v1/admin/users", { query })
}

export function loadAdminUser(userId: string) {
  return apiJSON<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}`)
}

export function createAdminUser(input: CreateUserInput) {
  return apiJSON<AdminUser>("/api/v1/admin/users", { method: "POST", body: input })
}

export function updateAdminUser(userId: string, input: UpdateUserInput) {
  return apiJSON<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: input })
}

export async function setAdminUserQuota(userId: string, input: SetUserQuotaInput) {
  await apiJSON<void>(`/api/v1/admin/users/${encodeURIComponent(userId)}/quota`, { method: "PUT", body: input })
  return loadAdminUser(userId)
}

export async function resetAdminUserPassword(userId: string, input: ResetUserPasswordInput) {
  await apiJSON<void>(`/api/v1/admin/users/${encodeURIComponent(userId)}/reset-password`, { method: "POST", body: input })
  return loadAdminUser(userId)
}

export async function setAdminUserEnabled(userId: string, enabled: boolean) {
  await apiJSON<void>(`/api/v1/admin/users/${encodeURIComponent(userId)}/${enabled ? "enable" : "disable"}`, { method: "POST" })
  return loadAdminUser(userId)
}

export function loadStorageOverview() {
  return apiJSON<StorageOverview>("/api/v1/admin/storage")
}

export function reconcileStorageQuota(input: ReconcileQuotaInput = {}) {
  return apiJSON<QuotaReconciliationPage>("/api/v1/admin/storage/reconcile", { method: "POST", body: input })
}

export function loadBotRuntime() {
  return apiJSON<BotRuntimeSnapshot>("/api/v1/admin/bots")
}

export function runBotAction(path: string) {
  return apiJSON<void>(`/api/v1${path}`, { method: "POST" })
}

export function loadAuditDiagnostics(query: AuditQuery) {
  return apiJSON<AuditPage>("/api/v1/admin/audit", { query })
}

export function loadJobDiagnostics(query: JobsQuery) {
  return apiJSON<JobPage>("/api/v1/admin/jobs", { query })
}

export function loadUploadDiagnostics(query: UploadDiagnosticsQuery) {
  return apiJSON<UploadDiagnosticPage>("/api/v1/admin/uploads", { query })
}
