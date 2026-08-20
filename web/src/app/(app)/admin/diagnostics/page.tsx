import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { AdminDiagnostics } from "@/components/admin/admin-diagnostics"
import { apiServerAuthJSON } from "@/lib/api/server"
import type { AuditPage, AuditQuery, JobPage, JobsQuery, UploadDiagnosticPage, UploadDiagnosticsQuery, User } from "@/lib/api/models"

export const metadata: Metadata = {
  title: "Diagnostics",
}

export default async function AdminDiagnosticsPage() {
  const user = await apiServerAuthJSON<User>("/auth/me")
  if (user.role !== "admin") redirect("/files")

  const auditQuery = { limit: 25 } satisfies AuditQuery
  const jobsQuery = { limit: 25 } satisfies JobsQuery
  const uploadsQuery = { limit: 25 } satisfies UploadDiagnosticsQuery

  const [audit, jobs, uploads] = await Promise.all([
    apiServerAuthJSON<AuditPage>("/admin/audit", { query: auditQuery }),
    apiServerAuthJSON<JobPage>("/admin/jobs", { query: jobsQuery }),
    apiServerAuthJSON<UploadDiagnosticPage>("/admin/uploads", { query: uploadsQuery }),
  ])

  return <AdminDiagnostics initialAudit={audit} initialJobs={jobs} initialUploads={uploads} />
}