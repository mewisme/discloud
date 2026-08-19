import { DownloadIcon, FileIcon, FolderIcon, TriangleAlertIcon } from "lucide-react"
import Link from "next/link"
import { FilePreview } from "@/components/files/file-preview"
import { CompactBreadcrumbs } from "@/components/navigation/compact-breadcrumbs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { File, Node } from "@/lib/api/models"
import { formatBytes, formatDuration, formatNumber } from "@/lib/helpers"

export function FileDetail({ file, breadcrumbs }: { file: File; breadcrumbs: readonly Node[] }) {
  const parent = breadcrumbs[breadcrumbs.length - 1]
  const parentHref = parent?.isRoot ? "/files" : parent ? `/files/${encodeURIComponent(parent.id)}` : "/files"
  const breadcrumbItems = [
    ...breadcrumbs.map((item) => ({
      id: item.id,
      label: item.isRoot ? "Files" : item.name,
      href: item.isRoot ? "/files" : `/files/${encodeURIComponent(item.id)}`,
    })),
    { id: `file:${file.id}`, label: file.name },
  ]

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <CompactBreadcrumbs items={breadcrumbItems} />
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileIcon className="size-5 shrink-0" />
            <h1 className="truncate text-2xl font-semibold tracking-tight">{file.name}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{formatBytes(file.size)} · {file.mimeType}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href={parentHref}>
              <FolderIcon />
              Parent folder
            </Link>
          </Button>
          <Button asChild>
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
          <AlertDescription>{file.metadataError || "The file is still available for preview and download."}</AlertDescription>
        </Alert>
      )}
      {file.metadataStatus === "pending" && (
        <Alert>
          <FileIcon />
          <AlertTitle>Metadata processing</AlertTitle>
          <AlertDescription>Technical metadata is still being extracted. Preview and download remain available.</AlertDescription>
        </Alert>
      )}

      <FilePreview file={file} />

      <Card>
        <CardHeader>
          <CardTitle>File details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Type" value={file.category} />
          <Detail label="MIME type" value={file.mimeType} />
          <Detail label="Extension" value={file.extension || "—"} />
          <Detail label="Size" value={formatBytes(file.size)} />
          <Detail label="Chunk size" value={formatBytes(file.chunkSize)} />
          <Detail label="Metadata" value={<Badge variant="secondary">{file.metadataStatus}</Badge>} />
          {file.width != null && file.height != null && <Detail label="Dimensions" value={`${file.width} × ${file.height}`} />}
          {file.durationMs != null && <Detail label="Duration" value={formatDuration(file.durationMs)} />}
          {file.bitrateBps != null && <Detail label="Bitrate" value={`${formatNumber(file.bitrateBps / 1000)} kbps`} />}
          {file.codec && <Detail label="Codec" value={file.codec} />}
          {file.sha256 && <Detail className="sm:col-span-2 lg:col-span-3" label="SHA-256" value={<code className="break-all font-mono text-xs">{file.sha256}</code>} />}
        </CardContent>
      </Card>
    </div>
  )
}

function Detail({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  )
}