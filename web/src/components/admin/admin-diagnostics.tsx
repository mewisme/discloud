"use client"

import { AuditDiagnostics } from "@/components/admin/diagnostics/audit-diagnostics"
import { JobDiagnostics } from "@/components/admin/diagnostics/job-diagnostics"
import { UploadDiagnostics } from "@/components/admin/diagnostics/upload-diagnostics"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AuditPage, JobPage, UploadDiagnosticPage } from "@/lib/api/models"

export function AdminDiagnostics({
  initialAudit,
  initialJobs,
  initialUploads,
}: {
  initialAudit: AuditPage
  initialJobs: JobPage
  initialUploads: UploadDiagnosticPage
}) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Diagnostics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Inspect audit events, background jobs, and upload sessions.
        </p>
      </div>

      <Tabs defaultValue="audit">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="uploads">Uploads</TabsTrigger>
        </TabsList>

        <TabsContent value="audit" className="pt-4">
          <AuditDiagnostics initialPage={initialAudit} />
        </TabsContent>

        <TabsContent value="jobs" className="pt-4">
          <JobDiagnostics initialPage={initialJobs} />
        </TabsContent>

        <TabsContent value="uploads" className="pt-4">
          <UploadDiagnostics initialPage={initialUploads} />
        </TabsContent>
      </Tabs>
    </div>
  )
}