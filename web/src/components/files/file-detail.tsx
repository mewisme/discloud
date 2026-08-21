"use client"

import { DownloadIcon, FileIcon, FolderIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import { useWorkspace } from "@/components/app/workspace-context"
import { FilePreviewCarousel, type PreviewCarouselFile } from "@/components/files/file-preview-carousel"
import { CompactBreadcrumbs } from "@/components/navigation/compact-breadcrumbs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { File, Node } from "@/lib/api/models"
import { folderBrowserPath, workspacePath } from "@/lib/files/navigation"
import { formatBytes, formatDuration, formatNumber } from "@/lib/helpers"

export function FileDetail({
  file,
  breadcrumbs,
  previewFiles,
}: {
  file: File
  breadcrumbs: readonly Node[]
  previewFiles: readonly PreviewCarouselFile[]
}) {
  const workspace = useWorkspace()
  const parent = breadcrumbs[breadcrumbs.length - 1]
  const parentHref = parent?.isRoot
    ? folderBrowserPath(workspace.username)
    : parent
      ? folderBrowserPath(workspace.username, parent.id)
      : folderBrowserPath(workspace.username)

  const breadcrumbItems = [
    ...breadcrumbs.map((item) => ({
      id: item.id,
      label: item.isRoot ? `${workspace.username}'s Workspace` : item.name,
      href: folderBrowserPath(workspace.username, item.isRoot ? undefined : item.id),
    })),
    { id: `file:${file.id}`, label: file.name },
  ]

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <CompactBreadcrumbs items={breadcrumbItems} />

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
            <Link href={parentHref}>
              <FolderIcon />
              Parent folder
            </Link>
          </Button>

          <Button size="sm" asChild>
            <a href={`/api/backend/api/v1/files/${encodeURIComponent(file.id)}/download`}>
              <DownloadIcon />
              Download
            </a>
          </Button>
        </div>
      </div>

      {file.metadataStatus === "failed" && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Metadata extraction failed</AlertTitle>
          <AlertDescription>{file.metadataError || "The file remains available for preview and download."}</AlertDescription>
        </Alert>
      )}

      {file.metadataStatus === "pending" && (
        <Alert>
          <FileIcon />
          <AlertTitle>Metadata processing</AlertTitle>
          <AlertDescription>Technical metadata is still being extracted. Preview and download remain available.</AlertDescription>
        </Alert>
      )}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <section className="min-w-0" aria-label="File preview">
          <FilePreviewCarousel
            currentFile={file}
            files={previewFiles}
            routeBase={workspacePath(workspace.username, "files")}
          />
        </section>

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

          {(file.width != null || file.durationMs != null || file.bitrateBps != null || file.codec || file.sha256) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Technical details</CardTitle>
              </CardHeader>

              <CardContent className="space-y-4 text-sm">
                {file.width != null && file.height != null && <InfoRow label="Dimensions" value={`${file.width} × ${file.height}`} />}
                {file.durationMs != null && <InfoRow label="Duration" value={formatDuration(file.durationMs)} />}
                {file.bitrateBps != null && <InfoRow label="Bitrate" value={`${formatNumber(file.bitrateBps / 1000)} kbps`} />}
                {file.codec && <InfoRow label="Codec" value={file.codec} />}
                {file.sha256 && <InfoRow label="SHA-256" value={<code className="break-all font-mono text-xs">{file.sha256}</code>} />}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
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