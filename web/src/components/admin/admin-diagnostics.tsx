"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircleIcon, BracesIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { apiJSON } from "@/lib/api/client"
import type { AuditEvent, AuditPage, AuditQuery, JobDiagnostic, JobPage, JobsQuery, UploadDiagnostic, UploadDiagnosticPage, UploadDiagnosticsQuery } from "@/lib/api/models"
import { apiErrorMessage, formatBytes, formatDateTime, formatNumber } from "@/lib/helpers"

const pageSize = 25
type JobStatus = NonNullable<JobsQuery["status"]>
type UploadStatus = NonNullable<UploadDiagnosticsQuery["status"]>

export function AdminDiagnostics() {
  return (
    <Tabs defaultValue="audit">
      <TabsList variant="line" className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="audit">Audit log</TabsTrigger>
        <TabsTrigger value="jobs">Jobs</TabsTrigger>
        <TabsTrigger value="uploads">Uploads</TabsTrigger>
      </TabsList>

      <TabsContent value="audit" className="pt-4">
        <AuditDiagnostics />
      </TabsContent>

      <TabsContent value="jobs" className="pt-4">
        <JobDiagnostics />
      </TabsContent>

      <TabsContent value="uploads" className="pt-4">
        <UploadDiagnostics />
      </TabsContent>
    </Tabs>
  )
}

function AuditDiagnostics() {
  const [events, setEvents] = useState<readonly AuditEvent[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [action, setAction] = useState("")
  const [actorUserId, setActorUserId] = useState("")
  const [resourceType, setResourceType] = useState("")
  const [resourceId, setResourceId] = useState("")
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (cursor?: string, append = false) => {
    setLoading(true)

    try {
      const query = {
        limit: pageSize,
        ...(cursor ? { cursor } : {}),
        ...(action.trim() ? { action: action.trim() } : {}),
        ...(actorUserId.trim() ? { actorUserId: actorUserId.trim() } : {}),
        ...(resourceType.trim() ? { resourceType: resourceType.trim() } : {}),
        ...(resourceId.trim() ? { resourceId: resourceId.trim() } : {}),
      } satisfies AuditQuery

      const page = await apiJSON<AuditPage>("/admin/audit", { query })
      setEvents((current) => append ? [...current, ...page.events] : [...page.events])
      setNextCursor(page.nextCursor)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load audit events."))
    } finally {
      setLoading(false)
    }
  }, [action, actorUserId, resourceId, resourceType])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field>
          <FieldLabel htmlFor="audit-action">Action</FieldLabel>
          <Input id="audit-action" placeholder="user.update" value={action} onChange={(event) => setAction(event.target.value)} />
        </Field>

        <Field>
          <FieldLabel htmlFor="audit-actor">Actor user ID</FieldLabel>
          <Input id="audit-actor" placeholder="UUID" value={actorUserId} onChange={(event) => setActorUserId(event.target.value)} />
        </Field>

        <Field>
          <FieldLabel htmlFor="audit-resource-type">Resource type</FieldLabel>
          <Input id="audit-resource-type" placeholder="user" value={resourceType} onChange={(event) => setResourceType(event.target.value)} />
        </Field>

        <Field>
          <FieldLabel htmlFor="audit-resource-id">Resource ID</FieldLabel>
          <Input id="audit-resource-id" placeholder="UUID" value={resourceId} onChange={(event) => setResourceId(event.target.value)} />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
          Apply filters
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="hidden lg:table-cell">Actor</TableHead>
              <TableHead className="hidden md:table-cell">Resource</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(event.createdAt)}</TableCell>

                <TableCell>
                  <Badge variant="outline" className="font-mono font-normal">{event.action}</Badge>
                </TableCell>

                <TableCell className="hidden max-w-48 truncate font-mono text-xs text-muted-foreground lg:table-cell">
                  {event.actorUserId ?? "system"}
                </TableCell>

                <TableCell className="hidden md:table-cell">
                  <div className="max-w-64">
                    <div className="text-sm">{event.resourceType || "—"}</div>
                    {event.resourceId && <div className="truncate font-mono text-xs text-muted-foreground">{event.resourceId}</div>}
                  </div>
                </TableCell>

                <TableCell>
                  <JSONDialog title={event.action} description="Audit event metadata" value={event.metadata} />
                </TableCell>
              </TableRow>
            ))}

            {!loading && events.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No audit events found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <LoadMoreFooter loading={loading} hasMore={!!nextCursor} onLoad={() => void load(nextCursor, true)} />
      </div>
    </div>
  )
}

function JobDiagnostics() {
  const [jobs, setJobs] = useState<readonly JobDiagnostic[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [status, setStatus] = useState<JobStatus | "all">("all")
  const [type, setType] = useState("")
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (cursor?: string, append = false) => {
    setLoading(true)

    try {
      const query = {
        limit: pageSize,
        ...(cursor ? { cursor } : {}),
        ...(status !== "all" ? { status } : {}),
        ...(type.trim() ? { type: type.trim() } : {}),
      } satisfies JobsQuery

      const page = await apiJSON<JobPage>("/admin/jobs", { query })
      setJobs((current) => append ? [...current, ...page.jobs] : [...page.jobs])
      setNextCursor(page.nextCursor)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load jobs."))
    } finally {
      setLoading(false)
    }
  }, [status, type])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>Status</FieldLabel>
          <Select value={status} onValueChange={(value) => setStatus(value as JobStatus | "all")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="dead">Dead</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="job-type">Job type</FieldLabel>
          <Input id="job-type" placeholder="metadata.extract" value={type} onChange={(event) => setType(event.target.value)} />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
          Apply filters
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Updated</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Attempts</TableHead>
              <TableHead className="hidden lg:table-cell">Run at</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(job.updatedAt)}</TableCell>
                <TableCell className="font-mono text-xs">{job.type}</TableCell>
                <TableCell><StatusBadge status={job.status} /></TableCell>
                <TableCell className="hidden tabular-nums md:table-cell">{job.attempts} / {job.maxAttempts}</TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{formatDateTime(job.runAt)}</TableCell>
                <TableCell>
                  <JSONDialog
                    title={job.type}
                    description={job.lastError || "Job payload"}
                    value={{
                      id: job.id,
                      status: job.status,
                      priority: job.priority,
                      attempts: job.attempts,
                      maxAttempts: job.maxAttempts,
                      lockedAt: job.lockedAt,
                      lockedBy: job.lockedBy,
                      completedAt: job.completedAt,
                      lastError: job.lastError,
                      payload: job.payload,
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}

            {!loading && jobs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No jobs found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <LoadMoreFooter loading={loading} hasMore={!!nextCursor} onLoad={() => void load(nextCursor, true)} />
      </div>
    </div>
  )
}

function UploadDiagnostics() {
  const [uploads, setUploads] = useState<readonly UploadDiagnostic[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [status, setStatus] = useState<UploadStatus | "all">("all")
  const [ownerUserId, setOwnerUserId] = useState("")
  const [actorUserId, setActorUserId] = useState("")
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (cursor?: string, append = false) => {
    setLoading(true)

    try {
      const query = {
        limit: pageSize,
        ...(cursor ? { cursor } : {}),
        ...(status !== "all" ? { status } : {}),
        ...(ownerUserId.trim() ? { ownerUserId: ownerUserId.trim() } : {}),
        ...(actorUserId.trim() ? { actorUserId: actorUserId.trim() } : {}),
      } satisfies UploadDiagnosticsQuery

      const page = await apiJSON<UploadDiagnosticPage>("/admin/uploads", { query })
      setUploads((current) => append ? [...current, ...page.uploads] : [...page.uploads])
      setNextCursor(page.nextCursor)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load upload diagnostics."))
    } finally {
      setLoading(false)
    }
  }, [actorUserId, ownerUserId, status])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Field>
          <FieldLabel>Status</FieldLabel>
          <Select value={status} onValueChange={(value) => setStatus(value as UploadStatus | "all")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="completing">Completing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="upload-owner">Owner user ID</FieldLabel>
          <Input id="upload-owner" placeholder="UUID" value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} />
        </Field>

        <Field>
          <FieldLabel htmlFor="upload-actor">Actor user ID</FieldLabel>
          <Input id="upload-actor" placeholder="UUID" value={actorUserId} onChange={(event) => setActorUserId(event.target.value)} />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
          Apply filters
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Updated</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Parts</TableHead>
              <TableHead className="hidden lg:table-cell">Size</TableHead>
              <TableHead className="hidden xl:table-cell">Failures</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {uploads.map((upload) => (
              <TableRow key={upload.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(upload.updatedAt)}</TableCell>

                <TableCell>
                  <div className="max-w-64">
                    <div className="truncate font-medium">{upload.name}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{upload.id}</div>
                  </div>
                </TableCell>

                <TableCell><StatusBadge status={upload.status} /></TableCell>

                <TableCell className="hidden tabular-nums md:table-cell">
                  {formatNumber(upload.uploadedParts)} / {formatNumber(upload.expectedParts)}
                </TableCell>

                <TableCell className="hidden whitespace-nowrap tabular-nums lg:table-cell">
                  {formatBytes(upload.sizeBytes)}
                </TableCell>

                <TableCell className="hidden tabular-nums xl:table-cell">
                  {formatNumber(upload.failedAttempts)} / {formatNumber(upload.attemptCount)}
                </TableCell>

                <TableCell>
                  <JSONDialog
                    title={upload.name}
                    description={upload.lastErrorMessage || "Upload diagnostic details"}
                    value={{
                      id: upload.id,
                      status: upload.status,
                      actorUserId: upload.actorUserId,
                      ownerUserId: upload.ownerUserId,
                      parentFolderId: upload.parentFolderId,
                      sizeBytes: upload.sizeBytes,
                      reservedBytes: upload.reservedBytes,
                      expectedParts: upload.expectedParts,
                      uploadedParts: upload.uploadedParts,
                      attemptCount: upload.attemptCount,
                      failedAttempts: upload.failedAttempts,
                      lastErrorClass: upload.lastErrorClass,
                      lastErrorMessage: upload.lastErrorMessage,
                      createdAt: upload.createdAt,
                      updatedAt: upload.updatedAt,
                      expiresAt: upload.expiresAt,
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}

            {!loading && uploads.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No uploads found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <LoadMoreFooter loading={loading} hasMore={!!nextCursor} onLoad={() => void load(nextCursor, true)} />
      </div>
    </div>
  )
}

function JSONDialog({ title, description, value }: { title: string; description: string; value: unknown }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`View details for ${title}`}>
          <BracesIcon />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
          {JSON.stringify(value, null, 2)}
        </pre>
      </DialogContent>
    </Dialog>
  )
}

function LoadMoreFooter({ loading, hasMore, onLoad }: { loading: boolean; hasMore: boolean; onLoad: () => void }) {
  return (
    <div className="flex items-center justify-center border-t p-2">
      {hasMore ? (
        <Button size="sm" variant="ghost" disabled={loading} onClick={onLoad}>
          {loading && <Loader2Icon className="animate-spin" />}
          Load more
        </Button>
      ) : (
        <span className="py-1 text-xs text-muted-foreground">{loading ? "Loading…" : "End of results"}</span>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const unhealthy = status === "failed" || status === "dead" || status === "expired" || status === "cancelled"

  return (
    <Badge variant={unhealthy ? "destructive" : status === "running" || status === "completing" ? "secondary" : "outline"} className="capitalize">
      {unhealthy && <AlertCircleIcon />}
      {status}
    </Badge>
  )
}