"use client"

import { Field, FieldLabel } from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { DIAGNOSTICS_PAGE_SIZE, InfiniteScrollSentinel, JSONDialog, StatusBadge } from "@/components/admin/diagnostics/diagnostics-shared"
import { DiagnosticsFilterBar } from "@/components/admin/diagnostics-filter-bar"
import { DateTime } from "@/components/common/date-time"
import { apiJSON } from "@/lib/api/client"
import type { JobDiagnostic, JobPage, JobsQuery } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"

type JobStatus = NonNullable<JobsQuery["status"]>

export function JobDiagnostics({ initialPage }: { initialPage: JobPage }) {
  const [jobs, setJobs] = useState<JobDiagnostic[]>(() => [...initialPage.jobs])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [appliedQuery, setAppliedQuery] = useState<JobsQuery>({ limit: DIAGNOSTICS_PAGE_SIZE })
  const [status, setStatus] = useState<JobStatus | "all">("all")
  const [type, setType] = useState("")
  const [loading, setLoading] = useState(false)
  const [paginationError, setPaginationError] = useState<string>()
  const loadingRef = useRef(false)

  function currentQuery() {
    return {
      limit: DIAGNOSTICS_PAGE_SIZE,
      ...(status !== "all" ? { status } : {}),
      ...(type.trim() ? { type: type.trim() } : {}),
    } satisfies JobsQuery
  }

  async function load(query: JobsQuery, append = false) {
    if (loadingRef.current) return

    loadingRef.current = true
    setPaginationError(undefined)
    setLoading(true)

    try {
      const page = await apiJSON<JobPage>("/admin/jobs", { query })
      setJobs((current) => append ? [...current, ...page.jobs] : [...page.jobs])
      setNextCursor(page.nextCursor)
    } catch (error) {
      const message = apiErrorMessage(error, "Could not load jobs.")
      if (append) setPaginationError(message)
      else toast.error(message)
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

    const query = { limit: DIAGNOSTICS_PAGE_SIZE } satisfies JobsQuery
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
          <FieldLabel htmlFor="job-status" className="text-xs">Status</FieldLabel>

          <Select
            value={status}
            onValueChange={(value) => setStatus(value as JobStatus | "all")}
          >
            <SelectTrigger id="job-status" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              <SelectGroup>
                <SelectLabel>Job status</SelectLabel>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="dead">Dead</SelectItem>
              </SelectGroup>
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
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  <DateTime value={job.updatedAt} />
                </TableCell>

                <TableCell className="font-mono text-xs">{job.type}</TableCell>
                <TableCell><StatusBadge status={job.status} /></TableCell>

                <TableCell className="hidden tabular-nums md:table-cell">
                  {job.attempts} / {job.maxAttempts}
                </TableCell>

                <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                  <DateTime value={job.runAt} />
                </TableCell>

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
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No jobs found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <InfiniteScrollSentinel
          loading={loading}
          hasMore={!!nextCursor}
          error={paginationError}
          onLoad={() => nextCursor && void load({ ...appliedQuery, cursor: nextCursor }, true)}
          onRetry={() => nextCursor && void load({ ...appliedQuery, cursor: nextCursor }, true)}
        />
      </div>
    </div>
  )
}