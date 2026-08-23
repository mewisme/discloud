"use client"

import { Badge } from "@discloud/ui/components/badge"
import { Field, FieldLabel } from "@discloud/ui/components/field"
import { Input } from "@discloud/ui/components/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@discloud/ui/components/table"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { DIAGNOSTICS_PAGE_SIZE, InfiniteScrollSentinel, JSONDialog } from "@/components/admin/diagnostics/diagnostics-shared"
import { type DiagnosticsDateRange, DiagnosticsDateRangePicker, DiagnosticsFilterBar } from "@/components/admin/diagnostics-filter-bar"
import { DateTime } from "@/components/common/date-time"
import { useUserConfig } from "@/components/settings/user-config-context"
import { apiJSON } from "@/lib/api/client"
import type { AuditEvent, AuditPage, AuditQuery } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"
import { endOfDayISO, startOfDayISO } from "@/lib/timezone"

export function AuditDiagnostics({ initialPage }: { initialPage: AuditPage }) {
  const { timezone } = useUserConfig()
  const [events, setEvents] = useState<AuditEvent[]>(() => [...initialPage.events])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [action, setAction] = useState("")
  const [actorUserId, setActorUserId] = useState("")
  const [resourceType, setResourceType] = useState("")
  const [resourceId, setResourceId] = useState("")
  const [dateRange, setDateRange] = useState<DiagnosticsDateRange>()
  const [appliedQuery, setAppliedQuery] = useState<AuditQuery>({ limit: DIAGNOSTICS_PAGE_SIZE })
  const [loading, setLoading] = useState(false)
  const [paginationError, setPaginationError] = useState<string>()
  const loadingRef = useRef(false)

  function currentQuery() {
    return {
      limit: DIAGNOSTICS_PAGE_SIZE,
      ...(action.trim() ? { action: action.trim() } : {}),
      ...(actorUserId.trim() ? { actorUserId: actorUserId.trim() } : {}),
      ...(resourceType.trim() ? { resourceType: resourceType.trim() } : {}),
      ...(resourceId.trim() ? { resourceId: resourceId.trim() } : {}),
      ...(dateRange?.from ? {
        from: startOfDayISO(dateRange.from, timezone),
        to: endOfDayISO(dateRange.to ?? dateRange.from, timezone),
      } : {}),
    } satisfies AuditQuery
  }

  async function load(query: AuditQuery, append = false) {
    if (loadingRef.current) return

    loadingRef.current = true
    setPaginationError(undefined)
    setLoading(true)

    try {
      const page = await apiJSON<AuditPage>("/admin/audit", { query })
      setEvents((current) => append ? [...current, ...page.events] : [...page.events])
      setNextCursor(page.nextCursor)
    } catch (error) {
      const message = apiErrorMessage(error, "Could not load audit events.")
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
    setAction("")
    setActorUserId("")
    setResourceType("")
    setResourceId("")
    setDateRange(undefined)

    const query = { limit: DIAGNOSTICS_PAGE_SIZE } satisfies AuditQuery
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
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  <DateTime value={event.createdAt} />
                </TableCell>

                <TableCell>
                  <Badge variant="outline" className="font-mono font-normal">
                    {event.action}
                  </Badge>
                </TableCell>

                <TableCell className="hidden max-w-56 lg:table-cell">
                  {!event.actorUserId ? (
                    <span className="text-sm text-muted-foreground">system</span>
                  ) : event.actorName || event.actorUsername ? (
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {event.actorName || `@${event.actorUsername}`}
                      </p>

                      {event.actorName && event.actorUsername && (
                        <p className="truncate text-xs text-muted-foreground">
                          @{event.actorUsername}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {event.actorUserId}
                    </span>
                  )}
                </TableCell>

                <TableCell className="hidden md:table-cell">
                  <div className="max-w-64">
                    <div className="text-sm">{event.resourceType || "—"}</div>

                    {event.resourceName || event.resourceUsername ? (
                      <>
                        <div className="truncate text-sm">
                          {event.resourceName || `@${event.resourceUsername}`}
                        </div>

                        {event.resourceName && event.resourceUsername && (
                          <div className="truncate text-xs text-muted-foreground">
                            @{event.resourceUsername}
                          </div>
                        )}

                        {event.resourceId && (
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {event.resourceId}
                          </div>
                        )}
                      </>
                    ) : event.resourceId ? (
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {event.resourceId}
                      </div>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell>
                  <JSONDialog
                    title={event.action}
                    description="Audit event metadata"
                    value={event.metadata}
                  />
                </TableCell>
              </TableRow>
            ))}

            {!loading && events.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No audit events found.
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