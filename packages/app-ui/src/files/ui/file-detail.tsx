"use client"

import type { File } from "@discloud/api/models"
import { formatBytes, formatDuration, formatNumber } from "@discloud/shared/format"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Badge } from "@discloud/ui/components/badge"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { DownloadIcon, FileIcon, FolderIcon, InfoIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"
import type { ReactNode } from "react"
import { FileBreadcrumbs, type FileBreadcrumbItem } from "./file-breadcrumbs"

export function FileDetailView({
  file,
  breadcrumbs,
  parentHref,
  preview,
  downloadHref,
  downloading = false,
  downloadError,
  onDownload,
}: {
  file: File
  breadcrumbs: readonly FileBreadcrumbItem[]
  parentHref: string
  preview: ReactNode
  downloadHref?: string
  downloading?: boolean
  downloadError?: string
  onDownload?: () => void | Promise<void>
}) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <FileBreadcrumbs items={breadcrumbs} />

      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
              <FileIcon className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{file.name}</h1>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={parentHref}>
              <FolderIcon />
              Parent folder
            </a>
          </Button>

          <DownloadButton href={downloadHref} downloading={downloading} onDownload={onDownload} />
        </div>
      </div>

      {downloadError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Download failed</AlertTitle>
          <AlertDescription>{downloadError}</AlertDescription>
        </Alert>
      ) : null}

      {file.metadataStatus === "failed" ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Metadata extraction failed</AlertTitle>
          <AlertDescription>{file.metadataError || "The file remains available for preview and download."}</AlertDescription>
        </Alert>
      ) : null}

      {file.metadataStatus === "pending" ? (
        <Alert>
          <FileIcon />
          <AlertTitle>Metadata processing</AlertTitle>
          <AlertDescription>Technical metadata is still being extracted. Preview and download remain available.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <section className="min-w-0" aria-label="File preview">{preview}</section>

        <aside className="space-y-4 xl:sticky xl:top-16">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <InfoIcon className="size-4" />
                File information
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4 text-sm">
              <InfoRow label="Type" value={<span className="capitalize">{file.category || "File"}</span>} />
              <InfoRow label="MIME type" value={file.mimeType} />
              <InfoRow label="Extension" value={file.extension || "—"} />
              <InfoRow label="Size" value={formatBytes(file.size)} />
              <InfoRow label="Chunk size" value={formatBytes(file.chunkSize)} />
              <InfoRow label="Metadata" value={<Badge variant="secondary" className="capitalize">{file.metadataStatus}</Badge>} />
            </CardContent>
          </Card>

          {file.width != null || file.durationMs != null || file.bitrateBps != null || file.codec || file.sha256 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Technical details</CardTitle>
              </CardHeader>

              <CardContent className="space-y-4 text-sm">
                {file.width != null && file.height != null ? <InfoRow label="Dimensions" value={`${file.width} × ${file.height}`} /> : null}
                {file.durationMs != null ? <InfoRow label="Duration" value={formatDuration(file.durationMs)} /> : null}
                {file.bitrateBps != null ? <InfoRow label="Bitrate" value={`${formatNumber(file.bitrateBps / 1000)} kbps`} /> : null}
                {file.codec ? <InfoRow label="Codec" value={file.codec} /> : null}
                {file.sha256 ? <InfoRow label="SHA-256" value={<code className="break-all font-mono text-xs">{file.sha256}</code>} /> : null}
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

function DownloadButton({ href, downloading, onDownload }: { href?: string; downloading: boolean; onDownload?: () => void | Promise<void> }) {
  if (href) {
    return (
      <Button size="sm" asChild>
        <a href={href}>
          <DownloadIcon />
          Download
        </a>
      </Button>
    )
  }

  return (
    <Button size="sm" disabled={downloading || !onDownload} onClick={() => void onDownload?.()}>
      {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
      {downloading ? "Downloading..." : "Download"}
    </Button>
  )
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 wrap-break-word font-medium">{value}</div>
    </div>
  )
}