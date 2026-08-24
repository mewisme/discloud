import type { AuditEvent, AuditPage, AuditQuery, JobDiagnostic, JobPage, JobsQuery, UploadDiagnostic, UploadDiagnosticPage, UploadDiagnosticsQuery } from "@discloud/api/models"
import { FilterToolbar, type FilterToolbarFilter } from "@discloud/app-ui/shared/filter-toolbar"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@discloud/ui/components/dialog"
import { Input } from "@discloud/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@discloud/ui/components/tabs"
import { EyeIcon, Loader2Icon, RefreshCwIcon, SearchIcon, TriangleAlertIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"

import { errorMessage } from "#lib/instance"

import { loadAuditDiagnostics, loadJobDiagnostics, loadUploadDiagnostics } from "../core/api"
import { formatBytes, formatDateTime, formatNumber } from "../core/format"

const pageSize = 25

export function DesktopAdminDiagnosticsPage() {
  const [audit, setAudit] = useState<AuditPage>()
  const [jobs, setJobs] = useState<JobPage>()
  const [uploads, setUploads] = useState<UploadDiagnosticPage>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    setError(undefined)
    try {
      const [nextAudit, nextJobs, nextUploads] = await Promise.all([
        loadAuditDiagnostics({ limit: pageSize }),
        loadJobDiagnostics({ limit: pageSize }),
        loadUploadDiagnostics({ limit: pageSize }),
      ])
      setAudit(nextAudit)
      setJobs(nextJobs)
      setUploads(nextUploads)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  if (loading && !audit && !jobs && !uploads) return <LoadingState />

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div><h1 className="text-2xl font-semibold tracking-tight">Diagnostics</h1><p className="mt-1 text-sm text-muted-foreground">Inspect audit events, background jobs, and upload sessions.</p></div>
        <Button variant="outline" disabled={loading} onClick={() => void load()}><RefreshCwIcon className={loading ? "animate-spin" : ""} />Refresh all</Button>
      </div>

      {error ? <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Diagnostics unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      <Tabs defaultValue="audit">
        <TabsList variant="line" className="w-full justify-start"><TabsTrigger value="audit">Audit log</TabsTrigger><TabsTrigger value="jobs">Jobs</TabsTrigger><TabsTrigger value="uploads">Uploads</TabsTrigger></TabsList>
        <TabsContent value="audit" className="pt-4">{audit ? <AuditDiagnostics initialPage={audit} /> : null}</TabsContent>
        <TabsContent value="jobs" className="pt-4">{jobs ? <JobDiagnostics initialPage={jobs} /> : null}</TabsContent>
        <TabsContent value="uploads" className="pt-4">{uploads ? <UploadDiagnostics initialPage={uploads} /> : null}</TabsContent>
      </Tabs>
    </div>
  )
}

function AuditDiagnostics({ initialPage }: { initialPage: AuditPage }) {
  const [events, setEvents] = useState<AuditEvent[]>([...initialPage.events])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [query, setQuery] = useState<AuditQuery>({ limit: pageSize })
  const [action, setAction] = useState("")
  const [actorUserId, setActorUserId] = useState("")
  const [resourceType, setResourceType] = useState("")
  const [resourceId, setResourceId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  async function run(nextQuery: AuditQuery, append = false) {
    if (loading) return
    setLoading(true)
    setError(undefined)
    try {
      const page = await loadAuditDiagnostics(nextQuery)
      setEvents((current) => append ? [...current, ...page.events] : [...page.events])
      setNextCursor(page.nextCursor)
      setQuery({ ...nextQuery, cursor: undefined })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  function apply() {
    void run({ limit: pageSize, ...(action.trim() ? { action: action.trim() } : {}), ...(actorUserId.trim() ? { actorUserId: actorUserId.trim() } : {}), ...(resourceType.trim() ? { resourceType: resourceType.trim() } : {}), ...(resourceId.trim() ? { resourceId: resourceId.trim() } : {}) })
  }

  function reset() {
    setAction("")
    setActorUserId("")
    setResourceType("")
    setResourceId("")
    void run({ limit: pageSize })
  }

  function removeFilter(filter: "action" | "actor" | "resourceType" | "resource") {
    const next = { ...query }
    if (filter === "action") { delete next.action; setAction("") }
    if (filter === "actor") { delete next.actorUserId; setActorUserId("") }
    if (filter === "resourceType") { delete next.resourceType; setResourceType("") }
    if (filter === "resource") { delete next.resourceId; setResourceId("") }
    void run(next)
  }

  const filters = [
    ...(query.action ? [{ key: "action", label: `Action: ${query.action}`, onRemove: () => removeFilter("action") }] : []),
    ...(query.actorUserId ? [{ key: "actor", label: `Actor: ${query.actorUserId}`, onRemove: () => removeFilter("actor") }] : []),
    ...(query.resourceType ? [{ key: "resourceType", label: `Resource type: ${query.resourceType}`, onRemove: () => removeFilter("resourceType") }] : []),
    ...(query.resourceId ? [{ key: "resource", label: `Resource: ${query.resourceId}`, onRemove: () => removeFilter("resource") }] : []),
  ]

  return (
    <div className="space-y-3">
      <FilterGrid filters={filters} loading={loading} onApply={apply} onReset={reset}>
        <FilterInput label="Action" value={action} placeholder="user.update" onChange={setAction} />
        <FilterInput label="Actor" value={actorUserId} placeholder="User UUID" onChange={setActorUserId} />
        <FilterInput label="Resource type" value={resourceType} placeholder="user" onChange={setResourceType} />
        <FilterInput label="Resource" value={resourceId} placeholder="Resource UUID" onChange={setResourceId} />
      </FilterGrid>
      {error ? <InlineError message={error} /> : null}
      <div className="overflow-hidden rounded-xl border">
        <Table className="table-fixed">
          <TableHeader><TableRow><TableHead className="w-40">Time</TableHead><TableHead className="w-48">Action</TableHead><TableHead className="hidden w-48 lg:table-cell">Actor</TableHead><TableHead className="hidden md:table-cell">Resource</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
          <TableBody>
            {events.map((event) => <TableRow key={event.id}><TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(event.createdAt)}</TableCell><TableCell className="min-w-0 overflow-hidden"><Badge variant="outline" className="max-w-full overflow-hidden font-mono font-normal"><span className="truncate" title={event.action}>{event.action}</span></Badge></TableCell><TableCell className="hidden overflow-hidden text-ellipsis lg:table-cell" title={event.actorName || (event.actorUsername ? `@${event.actorUsername}` : event.actorUserId || "system")}>{event.actorName || (event.actorUsername ? `@${event.actorUsername}` : event.actorUserId || "system")}</TableCell><TableCell className="hidden min-w-0 overflow-hidden md:table-cell"><div className="min-w-0"><p className="truncate text-sm">{event.resourceType || "—"}{event.resourceName ? ` · ${event.resourceName}` : event.resourceUsername ? ` · @${event.resourceUsername}` : ""}</p>{event.resourceId ? <p className="truncate font-mono text-[11px] text-muted-foreground">{event.resourceId}</p> : null}</div></TableCell><TableCell><JSONDialogButton title={event.action} value={event.metadata} /></TableCell></TableRow>)}
            {!loading && !events.length ? <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No audit events found.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
        <LoadMore loading={loading} nextCursor={nextCursor} onLoad={() => nextCursor ? run({ ...query, cursor: nextCursor }, true) : Promise.resolve()} />
      </div>
    </div>
  )
}

function JobDiagnostics({ initialPage }: { initialPage: JobPage }) {
  const [jobs, setJobs] = useState<JobDiagnostic[]>([...initialPage.jobs])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [query, setQuery] = useState<JobsQuery>({ limit: pageSize })
  const [status, setStatus] = useState<NonNullable<JobsQuery["status"]> | "all">("all")
  const [type, setType] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  async function run(nextQuery: JobsQuery, append = false) {
    if (loading) return
    setLoading(true)
    setError(undefined)
    try {
      const page = await loadJobDiagnostics(nextQuery)
      setJobs((current) => append ? [...current, ...page.jobs] : [...page.jobs])
      setNextCursor(page.nextCursor)
      setQuery({ ...nextQuery, cursor: undefined })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  function apply() {
    void run({ limit: pageSize, ...(status !== "all" ? { status } : {}), ...(type.trim() ? { type: type.trim() } : {}) })
  }

  function reset() { setStatus("all"); setType(""); void run({ limit: pageSize }) }

  function removeFilter(filter: "status" | "type") {
    const next = { ...query }
    if (filter === "status") { delete next.status; setStatus("all") }
    if (filter === "type") { delete next.type; setType("") }
    void run(next)
  }

  const filters = [
    ...(query.status ? [{ key: "status", label: `Status: ${query.status}`, onRemove: () => removeFilter("status") }] : []),
    ...(query.type ? [{ key: "type", label: `Type: ${query.type}`, onRemove: () => removeFilter("type") }] : []),
  ]

  return (
    <div className="space-y-3">
      <FilterGrid filters={filters} loading={loading} onApply={apply} onReset={reset}>
        <div className="grid gap-1"><label className="text-xs font-medium">Status</label><Select value={status} onValueChange={(value) => setStatus(value as typeof status)}><SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="queued">Queued</SelectItem><SelectItem value="running">Running</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="dead">Dead</SelectItem></SelectContent></Select></div>
        <FilterInput label="Job type" value={type} placeholder="metadata.extract" onChange={setType} />
      </FilterGrid>
      {error ? <InlineError message={error} /> : null}
      <div className="overflow-hidden rounded-xl border">
        <Table className="table-fixed"><TableHeader><TableRow><TableHead className="w-40">Updated</TableHead><TableHead>Type</TableHead><TableHead className="w-28">Status</TableHead><TableHead className="hidden w-24 md:table-cell">Attempts</TableHead><TableHead className="hidden w-40 lg:table-cell">Run at</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{jobs.map((job) => <TableRow key={job.id}><TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(job.updatedAt)}</TableCell><TableCell className="min-w-0 overflow-hidden"><div className="truncate font-mono text-xs" title={job.type}>{job.type}</div></TableCell><TableCell><StatusBadge status={job.status} /></TableCell><TableCell className="hidden tabular-nums md:table-cell">{job.attempts} / {job.maxAttempts}</TableCell><TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{formatDateTime(job.runAt)}</TableCell><TableCell><JSONDialogButton title={job.type} value={{ id: job.id, status: job.status, priority: job.priority, attempts: job.attempts, maxAttempts: job.maxAttempts, lockedAt: job.lockedAt, lockedBy: job.lockedBy, completedAt: job.completedAt, lastError: job.lastError, payload: job.payload }} /></TableCell></TableRow>)}{!loading && !jobs.length ? <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No jobs found.</TableCell></TableRow> : null}</TableBody></Table>
        <LoadMore loading={loading} nextCursor={nextCursor} onLoad={() => nextCursor ? run({ ...query, cursor: nextCursor }, true) : Promise.resolve()} />
      </div>
    </div>
  )
}

function UploadDiagnostics({ initialPage }: { initialPage: UploadDiagnosticPage }) {
  const [uploads, setUploads] = useState<UploadDiagnostic[]>([...initialPage.uploads])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [query, setQuery] = useState<UploadDiagnosticsQuery>({ limit: pageSize })
  const [status, setStatus] = useState<NonNullable<UploadDiagnosticsQuery["status"]> | "all">("all")
  const [ownerUserId, setOwnerUserId] = useState("")
  const [actorUserId, setActorUserId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  async function run(nextQuery: UploadDiagnosticsQuery, append = false) {
    if (loading) return
    setLoading(true)
    setError(undefined)
    try {
      const page = await loadUploadDiagnostics(nextQuery)
      setUploads((current) => append ? [...current, ...page.uploads] : [...page.uploads])
      setNextCursor(page.nextCursor)
      setQuery({ ...nextQuery, cursor: undefined })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  function apply() {
    void run({ limit: pageSize, ...(status !== "all" ? { status } : {}), ...(ownerUserId.trim() ? { ownerUserId: ownerUserId.trim() } : {}), ...(actorUserId.trim() ? { actorUserId: actorUserId.trim() } : {}) })
  }

  function reset() { setStatus("all"); setOwnerUserId(""); setActorUserId(""); void run({ limit: pageSize }) }

  function removeFilter(filter: "status" | "owner" | "actor") {
    const next = { ...query }
    if (filter === "status") { delete next.status; setStatus("all") }
    if (filter === "owner") { delete next.ownerUserId; setOwnerUserId("") }
    if (filter === "actor") { delete next.actorUserId; setActorUserId("") }
    void run(next)
  }

  const filters = [
    ...(query.status ? [{ key: "status", label: `Status: ${query.status}`, onRemove: () => removeFilter("status") }] : []),
    ...(query.ownerUserId ? [{ key: "owner", label: `Owner: ${query.ownerUserId}`, onRemove: () => removeFilter("owner") }] : []),
    ...(query.actorUserId ? [{ key: "actor", label: `Actor: ${query.actorUserId}`, onRemove: () => removeFilter("actor") }] : []),
  ]

  return (
    <div className="space-y-3">
      <FilterGrid filters={filters} loading={loading} onApply={apply} onReset={reset}>
        <div className="grid gap-1"><label className="text-xs font-medium">Status</label><Select value={status} onValueChange={(value) => setStatus(value as typeof status)}><SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="open">Open</SelectItem><SelectItem value="completing">Completing</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem><SelectItem value="expired">Expired</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent></Select></div>
        <FilterInput label="Owner" value={ownerUserId} placeholder="User UUID" onChange={setOwnerUserId} />
        <FilterInput label="Actor" value={actorUserId} placeholder="User UUID" onChange={setActorUserId} />
      </FilterGrid>
      {error ? <InlineError message={error} /> : null}
      <div className="overflow-hidden rounded-xl border">
        <Table className="table-fixed"><TableHeader><TableRow><TableHead className="w-40">Updated</TableHead><TableHead>Name</TableHead><TableHead className="w-28">Status</TableHead><TableHead className="hidden w-24 md:table-cell">Parts</TableHead><TableHead className="hidden w-28 lg:table-cell">Size</TableHead><TableHead className="hidden w-24 xl:table-cell">Failures</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{uploads.map((upload) => <TableRow key={upload.id}><TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(upload.updatedAt)}</TableCell><TableCell className="min-w-0 overflow-hidden"><div className="min-w-0"><p className="truncate font-medium" title={upload.name}>{upload.name}</p><p className="truncate text-xs text-muted-foreground">Owner: {upload.ownerName} · @{upload.ownerUsername}</p><p className="truncate text-xs text-muted-foreground">Actor: {upload.actorName} · @{upload.actorUsername}</p></div></TableCell><TableCell><StatusBadge status={upload.status} /></TableCell><TableCell className="hidden tabular-nums md:table-cell">{formatNumber(upload.uploadedParts)} / {formatNumber(upload.expectedParts)}</TableCell><TableCell className="hidden tabular-nums lg:table-cell">{formatBytes(upload.sizeBytes)}</TableCell><TableCell className="hidden tabular-nums xl:table-cell">{formatNumber(upload.failedAttempts)} / {formatNumber(upload.attemptCount)}</TableCell><TableCell><JSONDialogButton title={upload.name} value={upload} /></TableCell></TableRow>)}{!loading && !uploads.length ? <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No uploads found.</TableCell></TableRow> : null}</TableBody></Table>
        <LoadMore loading={loading} nextCursor={nextCursor} onLoad={() => nextCursor ? run({ ...query, cursor: nextCursor }, true) : Promise.resolve()} />
      </div>
    </div>
  )
}

function FilterGrid({ children, filters, loading, onApply, onReset }: { children: ReactNode; filters: readonly FilterToolbarFilter[]; loading: boolean; onApply: () => void; onReset: () => void }) {
  return <FilterToolbar filters={filters} onClear={onReset} contentClassName="md:grid-cols-2 xl:grid-cols-4" footer={(close) => <FilterActions loading={loading} onReset={onReset} onApply={() => { onApply(); close() }} />}>{children}</FilterToolbar>
}

function FilterInput({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <div className="grid gap-1"><label className="text-xs font-medium">{label}</label><Input className="h-8" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></div>
}

function FilterActions({ loading, onApply, onReset }: { loading: boolean; onApply: () => void; onReset: () => void }) {
  return <><Button size="sm" variant="outline" disabled={loading} onClick={onReset}>Reset</Button><Button size="sm" disabled={loading} onClick={onApply}>{loading ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}Apply</Button></>
}

function StatusBadge({ status }: { status: string }) {
  const destructive = status === "failed" || status === "dead" || status === "expired"
  const secondary = status === "running" || status === "completing" || status === "completed"
  return <Badge variant={destructive ? "destructive" : secondary ? "secondary" : "outline"} className="capitalize">{status}</Badge>
}

function LoadMore({ loading, nextCursor, onLoad }: { loading: boolean; nextCursor?: string | null; onLoad: () => Promise<void> }) {
  return <div className="flex justify-center border-t p-3">{nextCursor ? <Button size="sm" variant="outline" disabled={loading} onClick={() => void onLoad()}>{loading ? <Loader2Icon className="animate-spin" /> : null}{loading ? "Loading" : "Load more"}</Button> : <span className="text-xs text-muted-foreground">End of results</span>}</div>
}

function JSONDialogButton({ title, value }: { title: string; value: unknown }) {
  const [open, setOpen] = useState(false)
  return <Dialog open={open} onOpenChange={setOpen}><Button size="icon-sm" variant="ghost" aria-label={`Inspect ${title}`} onClick={() => setOpen(true)}><EyeIcon /></Button><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Diagnostic details</DialogDescription></DialogHeader><pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre></DialogContent></Dialog>
}

function InlineError({ message }: { message: string }) {
  return <Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Request failed</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>
}

function LoadingState() {
  return <div className="grid min-h-64 place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="animate-spin" />Loading diagnostics</div></div>
}
