"use client"

import { Field, FieldLabel } from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@discloud/ui/components/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { DIAGNOSTICS_PAGE_SIZE, JSONDialog, StatusBadge } from "@/components/admin/diagnostics/diagnostics-shared"
import { DiagnosticsFilterBar } from "@/components/admin/diagnostics-filter-bar"
import { DateTime } from "@/components/common/date-time"
import { PaginationTrigger } from "@/components/common/pagination-trigger"
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
      if (append) throw error
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

  function removeFilter(filter: "status" | "type") {
    const query = { ...appliedQuery }
    if (filter === "status") { delete query.status; setStatus("all") }
    if (filter === "type") { delete query.type; setType("") }
    setAppliedQuery(query)
    void load(query)
  }

  const filters = [
    ...(appliedQuery.status ? [{ key: "status", label: `Status: ${appliedQuery.status}`, onRemove: () => removeFilter("status") }] : []),
    ...(appliedQuery.type ? [{ key: "type", label: `Type: ${appliedQuery.type}`, onRemove: () => removeFilter("type") }] : []),
  ]

  return (
    <div className="space-y-3">
      <DiagnosticsFilterBar
        className="sm:grid-cols-2"
        filters={filters}
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
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Updated</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="hidden w-24 md:table-cell">Attempts</TableHead>
              <TableHead className="hidden w-40 lg:table-cell">Run at</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="overflow-hidden whitespace-nowrap text-muted-foreground">
                  <DateTime value={job.updatedAt} className="block truncate" />
                </TableCell>

                <TableCell className="min-w-0 overflow-hidden"><div className="truncate font-mono text-xs" title={job.type}>{job.type}</div></TableCell>
                <TableCell><StatusBadge status={job.status} /></TableCell>

                <TableCell className="hidden tabular-nums md:table-cell">
                  {job.attempts} / {job.maxAttempts}
                </TableCell>

                <TableCell className="hidden overflow-hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                  <DateTime value={job.runAt} className="block truncate" />
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

        {paginationError ? <div role="alert" className="border-t px-3 py-2 text-center text-xs text-destructive">{paginationError}</div> : null}
        {nextCursor ? <PaginationTrigger loadKey={nextCursor} hasMore loading={loading} onLoadMore={() => load({ ...appliedQuery, cursor: nextCursor }, true)} className="border-t p-2" loadingLabel="Loading more jobs…" /> : null}
      </div>
    </div>
  )
}