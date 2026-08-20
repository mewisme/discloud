"use client"

import { useEffect, useRef, useState } from "react"
import { AlertCircleIcon, BracesIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { DiagnosticsDateRangePicker, DiagnosticsFilterBar, type DiagnosticsDateRange } from "@/components/admin/diagnostics-filter-bar"
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
        <p className="mt-1 text-sm text-muted-foreground">Inspect audit events, background jobs, and upload sessions.</p>
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

function AuditDiagnostics({ initialPage }: { initialPage: AuditPage }) {
  const [events, setEvents] = useState<AuditEvent[]>(() => [...initialPage.events])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [action, setAction] = useState("")
  const [actorUserId, setActorUserId] = useState("")
  const [resourceType, setResourceType] = useState("")
  const [resourceId, setResourceId] = useState("")
  const [dateRange, setDateRange] = useState<DiagnosticsDateRange>()
  const [appliedQuery, setAppliedQuery] = useState<AuditQuery>({ limit: pageSize })
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)

  function currentQuery() {
    return {
      limit: pageSize,
      ...(action.trim() ? { action: action.trim() } : {}),
      ...(actorUserId.trim() ? { actorUserId: actorUserId.trim() } : {}),
      ...(resourceType.trim() ? { resourceType: resourceType.trim() } : {}),
      ...(resourceId.trim() ? { resourceId: resourceId.trim() } : {}),
      ...(dateRange?.from ? {
        from: startOfLocalDayISO(dateRange.from),
        to: endOfLocalDayISO(dateRange.to ?? dateRange.from),
      } : {}),
    } satisfies AuditQuery
  }

  async function load(query: AuditQuery, append = false) {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)

    try {
      const page = await apiJSON<AuditPage>("/admin/audit", { query })
      setEvents((current) => append ? [...current, ...page.events] : [...page.events])
      setNextCursor(page.nextCursor)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load audit events."))
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  function applyFilters() {
    const query = currentQuery()
    setAppliedQuery(query)
    void load(query)
  }

  function resetFilters() {
    setAction("")
    setActorUserId("")
    setResourceType("")
    setResourceId("")
    setDateRange(undefined)

    const query = { limit: pageSize } satisfies AuditQuery
    setAppliedQuery(query)
    void load(query)
  }

  return (
    <div className="space-y-3">
      <DiagnosticsFilterBar
        className="sm:grid-cols-2 xl:grid-cols-5"
        loading={loading}
        onApply={applyFilters}
        onReset={resetFilters}
      >
        <Field className="gap-1">
          <FieldLabel htmlFor="audit-action" className="text-xs">Action</FieldLabel>
          <Input
            id="audit-action"
            className="h-8"
            placeholder="user.update"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
        </Field>

        <Field className="gap-1">
          <FieldLabel htmlFor="audit-actor" className="text-xs">Actor</FieldLabel>
          <Input
            id="audit-actor"
            className="h-8"
            placeholder="User UUID"
            value={actorUserId}
            onChange={(event) => setActorUserId(event.target.value)}
          />
        </Field>

        <Field className="gap-1">
          <FieldLabel htmlFor="audit-resource-type" className="text-xs">Resource type</FieldLabel>
          <Input
            id="audit-resource-type"
            className="h-8"
            placeholder="user"
            value={resourceType}
            onChange={(event) => setResourceType(event.target.value)}
          />
        </Field>

        <Field className="gap-1">
          <FieldLabel htmlFor="audit-resource-id" className="text-xs">Resource</FieldLabel>
          <Input
            id="audit-resource-id"
            className="h-8"
            placeholder="Resource UUID"
            value={resourceId}
            onChange={(event) => setResourceId(event.target.value)}
          />
        </Field>

        <Field className="gap-1">
          <FieldLabel className="text-xs">Date range</FieldLabel>
          <DiagnosticsDateRangePicker value={dateRange} onChange={setDateRange} />
        </Field>
      </DiagnosticsFilterBar>

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
                <TableCell><Badge variant="outline" className="font-mono font-normal">{event.action}</Badge></TableCell>
                <TableCell className="hidden max-w-48 truncate font-mono text-xs text-muted-foreground lg:table-cell">{event.actorUserId ?? "system"}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="max-w-64">
                    <div className="text-sm">{event.resourceType || "—"}</div>
                    {event.resourceId && <div className="truncate font-mono text-xs text-muted-foreground">{event.resourceId}</div>}
                  </div>
                </TableCell>
                <TableCell><JSONDialog title={event.action} description="Audit event metadata" value={event.metadata} /></TableCell>
              </TableRow>
            ))}

            {!loading && events.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No audit events found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <InfiniteScrollSentinel
          loading={loading}
          hasMore={!!nextCursor}
          onLoad={() => nextCursor && void load({ ...appliedQuery, cursor: nextCursor }, true)}
        />
      </div>
    </div>
  )
}

function JobDiagnostics({ initialPage }: { initialPage: JobPage }) {
  const [jobs, setJobs] = useState<JobDiagnostic[]>(() => [...initialPage.jobs])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [appliedQuery, setAppliedQuery] = useState<JobsQuery>({ limit: pageSize })
  const [status, setStatus] = useState<JobStatus | "all">("all")
  const [type, setType] = useState("")
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)

  function currentQuery() {
    return {
      limit: pageSize,
      ...(status !== "all" ? { status } : {}),
      ...(type.trim() ? { type: type.trim() } : {}),
    } satisfies JobsQuery
  }

  async function load(query: JobsQuery, append = false) {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)

    try {
      const page = await apiJSON<JobPage>("/admin/jobs", { query })
      setJobs((current) => append ? [...current, ...page.jobs] : [...page.jobs])
      setNextCursor(page.nextCursor)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load jobs."))
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  function applyFilters() {
    const query = currentQuery()
    setAppliedQuery(query)
    void load(query)
  }

  function resetFilters() {
    setStatus("all")
    setType("")

    const query = { limit: pageSize } satisfies JobsQuery
    setAppliedQuery(query)
    void load(query)
  }

  return (
    <div className="space-y-3">
      <DiagnosticsFilterBar
        className="sm:grid-cols-2"
        loading={loading}
        onApply={applyFilters}
        onReset={resetFilters}
      >
        <Field className="gap-1">
          <FieldLabel className="text-xs">Status</FieldLabel>
          <Select value={status} onValueChange={(value) => setStatus(value as JobStatus | "all")}>
            <SelectTrigger size="sm" className="w-full">
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

        <Field className="gap-1">
          <FieldLabel htmlFor="job-type" className="text-xs">Job type</FieldLabel>
          <Input
            id="job-type"
            className="h-8"
            placeholder="metadata.extract"
            value={type}
            onChange={(event) => setType(event.target.value)}
          />
        </Field>
      </DiagnosticsFilterBar>

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

        <InfiniteScrollSentinel
          loading={loading}
          hasMore={!!nextCursor}
          onLoad={() => nextCursor && void load({ ...appliedQuery, cursor: nextCursor }, true)}
        />
      </div>
    </div>
  )
}

function UploadDiagnostics({ initialPage }: { initialPage: UploadDiagnosticPage }) {
  const [uploads, setUploads] = useState<UploadDiagnostic[]>(() => [...initialPage.uploads])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [status, setStatus] = useState<UploadStatus | "all">("all")
  const [ownerUserId, setOwnerUserId] = useState("")
  const [actorUserId, setActorUserId] = useState("")
  const [appliedQuery, setAppliedQuery] = useState<UploadDiagnosticsQuery>({ limit: pageSize })
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)

  function currentQuery() {
    return {
      limit: pageSize,
      ...(status !== "all" ? { status } : {}),
      ...(ownerUserId.trim() ? { ownerUserId: ownerUserId.trim() } : {}),
      ...(actorUserId.trim() ? { actorUserId: actorUserId.trim() } : {}),
    } satisfies UploadDiagnosticsQuery
  }

  async function load(query: UploadDiagnosticsQuery, append = false) {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)

    try {
      const page = await apiJSON<UploadDiagnosticPage>("/admin/uploads", { query })
      setUploads((current) => append ? [...current, ...page.uploads] : [...page.uploads])
      setNextCursor(page.nextCursor)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load upload diagnostics."))
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  function applyFilters() {
    const query = currentQuery()
    setAppliedQuery(query)
    void load(query)
  }

  function resetFilters() {
    setStatus("all")
    setOwnerUserId("")
    setActorUserId("")

    const query = { limit: pageSize } satisfies UploadDiagnosticsQuery
    setAppliedQuery(query)
    void load(query)
  }

  return (
    <div className="space-y-3">
      <DiagnosticsFilterBar
        className="sm:grid-cols-3"
        loading={loading}
        onApply={applyFilters}
        onReset={resetFilters}
      >
        <Field className="gap-1">
          <FieldLabel className="text-xs">Status</FieldLabel>
          <Select value={status} onValueChange={(value) => setStatus(value as UploadStatus | "all")}>
            <SelectTrigger size="sm" className="w-full">
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

        <Field className="gap-1">
          <FieldLabel htmlFor="upload-owner" className="text-xs">Owner</FieldLabel>
          <Input
            id="upload-owner"
            className="h-8"
            placeholder="User UUID"
            value={ownerUserId}
            onChange={(event) => setOwnerUserId(event.target.value)}
          />
        </Field>

        <Field className="gap-1">
          <FieldLabel htmlFor="upload-actor" className="text-xs">Actor</FieldLabel>
          <Input
            id="upload-actor"
            className="h-8"
            placeholder="User UUID"
            value={actorUserId}
            onChange={(event) => setActorUserId(event.target.value)}
          />
        </Field>
      </DiagnosticsFilterBar>

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
                <TableCell className="hidden tabular-nums md:table-cell">{formatNumber(upload.uploadedParts)} / {formatNumber(upload.expectedParts)}</TableCell>
                <TableCell className="hidden whitespace-nowrap tabular-nums lg:table-cell">{formatBytes(upload.sizeBytes)}</TableCell>
                <TableCell className="hidden tabular-nums xl:table-cell">{formatNumber(upload.failedAttempts)} / {formatNumber(upload.attemptCount)}</TableCell>
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

        <InfiniteScrollSentinel
          loading={loading}
          hasMore={!!nextCursor}
          onLoad={() => nextCursor && void load({ ...appliedQuery, cursor: nextCursor }, true)}
        />
      </div>
    </div>
  )
}

function InfiniteScrollSentinel({
  loading,
  hasMore,
  onLoad,
}: {
  loading: boolean
  hasMore: boolean
  onLoad: () => void
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const onLoadRef = useRef(onLoad)

  useEffect(() => {
    onLoadRef.current = onLoad
  }, [onLoad])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || loading) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadRef.current()
      },
      { rootMargin: "320px 0px" },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading])

  return (
    <div ref={sentinelRef} className="flex min-h-10 items-center justify-center border-t">
      {loading && (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          Loading more…
        </div>
      )}

      {!loading && !hasMore && <span className="py-2 text-xs text-muted-foreground">End of results</span>}
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

        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>
      </DialogContent>
    </Dialog>
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

function startOfLocalDayISO(date: Date) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value.toISOString()
}

function endOfLocalDayISO(date: Date) {
  const value = new Date(date)
  value.setHours(23, 59, 59, 999)
  return value.toISOString()
}