"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"

import { DIAGNOSTICS_PAGE_SIZE, InfiniteScrollSentinel, JSONDialog, StatusBadge } from "@/components/admin/diagnostics/diagnostics-shared"
import { DiagnosticsFilterBar } from "@/components/admin/diagnostics-filter-bar"
import { DateTime } from "@/components/common/date-time"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiJSON } from "@/lib/api/client"
import type { UploadDiagnostic, UploadDiagnosticPage, UploadDiagnosticsQuery } from "@/lib/api/models"
import { apiErrorMessage, formatBytes, formatNumber } from "@/lib/helpers"

type UploadStatus = NonNullable<UploadDiagnosticsQuery["status"]>

export function UploadDiagnostics({
  initialPage,
}: {
  initialPage: UploadDiagnosticPage
}) {
  const [uploads, setUploads] = useState<UploadDiagnostic[]>(() => [...initialPage.uploads])
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [status, setStatus] = useState<UploadStatus | "all">("all")
  const [ownerUserId, setOwnerUserId] = useState("")
  const [actorUserId, setActorUserId] = useState("")
  const [appliedQuery, setAppliedQuery] = useState<UploadDiagnosticsQuery>({
    limit: DIAGNOSTICS_PAGE_SIZE,
  })
  const [loading, setLoading] = useState(false)
  const [paginationError, setPaginationError] = useState<string>()
  const loadingRef = useRef(false)

  function currentQuery() {
    return {
      limit: DIAGNOSTICS_PAGE_SIZE,
      ...(status !== "all" ? { status } : {}),
      ...(ownerUserId.trim() ? { ownerUserId: ownerUserId.trim() } : {}),
      ...(actorUserId.trim() ? { actorUserId: actorUserId.trim() } : {}),
    } satisfies UploadDiagnosticsQuery
  }

  async function load(query: UploadDiagnosticsQuery, append = false) {
    if (loadingRef.current) return

    loadingRef.current = true
    setPaginationError(undefined)
    setLoading(true)

    try {
      const page = await apiJSON<UploadDiagnosticPage>("/admin/uploads", { query })
      setUploads((current) => append ? [...current, ...page.uploads] : [...page.uploads])
      setNextCursor(page.nextCursor)
    } catch (error) {
      const message = apiErrorMessage(error, "Could not load upload diagnostics.")
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
    setOwnerUserId("")
    setActorUserId("")

    const query = {
      limit: DIAGNOSTICS_PAGE_SIZE,
    } satisfies UploadDiagnosticsQuery

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
          <FieldLabel htmlFor="upload-status" className="text-xs">Status</FieldLabel>

          <Select
            value={status}
            onValueChange={(value) => setStatus(value as UploadStatus | "all")}
          >
            <SelectTrigger id="upload-status" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              <SelectGroup>
                <SelectLabel>Upload status</SelectLabel>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="completing">Completing</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectGroup>
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
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  <DateTime value={upload.updatedAt} />
                </TableCell>

                <TableCell>
                  <div className="max-w-72">
                    <div className="truncate font-medium">{upload.name}</div>

                    <div className="truncate text-xs text-muted-foreground">
                      Owner: <span className="text-foreground">{upload.ownerName}</span> · @{upload.ownerUsername}
                    </div>

                    <div className="truncate text-xs text-muted-foreground">
                      Actor: <span className="text-foreground">{upload.actorName}</span> · @{upload.actorUsername}
                    </div>

                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {upload.id}
                    </div>
                  </div>
                </TableCell>

                <TableCell>
                  <StatusBadge status={upload.status} />
                </TableCell>

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
                      actorUsername: upload.actorUsername,
                      actorName: upload.actorName,
                      ownerUserId: upload.ownerUserId,
                      ownerUsername: upload.ownerUsername,
                      ownerName: upload.ownerName,
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
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No uploads found.
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