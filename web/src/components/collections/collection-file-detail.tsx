import { DownloadIcon, FileIcon, LibraryIcon } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import { DateTime } from "@/components/common/date-time"
import { FilePreviewCarousel, type PreviewCarouselFile } from "@/components/files/file-preview-carousel"
import { CompactBreadcrumbs } from "@/components/navigation/compact-breadcrumbs"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Collection, CollectionItem } from "@/lib/api/models"
import { formatBytes } from "@/lib/helpers"

export function CollectionFileDetail({
  collection,
  item,
  items,
}: {
  collection: Collection
  item: CollectionItem
  items: readonly CollectionItem[]
}) {
  const collectionHref = `/collections/${encodeURIComponent(collection.id)}`
  const previewFile = toPreviewFile(item)
  const previewFiles = items.map(toPreviewFile)
  const breadcrumbItems = [
    { id: "collections", label: "Collections", href: "/collections" },
    { id: `collection:${collection.id}`, label: collection.name, href: collectionHref },
    { id: `file:${item.fileId}`, label: item.name },
  ]

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <CompactBreadcrumbs items={breadcrumbItems} />

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileIcon className="size-5 shrink-0" />
            <h1 className="truncate text-2xl font-semibold tracking-tight">{item.name}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{formatBytes(item.size)} · {item.mimeType}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href={collectionHref}>
              <LibraryIcon />
              Collection
            </Link>
          </Button>

          <Button asChild>
            <a href={downloadURL(collection.id, item.fileId)}>
              <DownloadIcon />
              Download
            </a>
          </Button>
        </div>
      </div>

      <FilePreviewCarousel
        currentFile={previewFile}
        files={previewFiles}
        collectionId={collection.id}
        routeBase={`/collections/${encodeURIComponent(collection.id)}/files`}
      />

      <Card>
        <CardHeader>
          <CardTitle>File details</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Type" value={item.category} />
          <Detail label="MIME type" value={item.mimeType} />
          <Detail label="Size" value={formatBytes(item.size)} />
          <Detail label="Added" value={<DateTime value={item.addedAt} />} />
          <Detail label="Created" value={<DateTime value={item.createdAt} />} />
          <Detail label="Modified" value={<DateTime value={item.updatedAt} />} />
          {item.sha256 && <Detail className="sm:col-span-2 lg:col-span-3" label="SHA-256" value={<code className="break-all font-mono text-xs">{item.sha256}</code>} />}
        </CardContent>
      </Card>
    </div>
  )
}

function toPreviewFile(item: CollectionItem): PreviewCarouselFile {
  return {
    id: item.fileId,
    name: item.name,
    size: item.size,
    mimeType: item.mimeType,
    category: item.category,
  }
}

function Detail({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  )
}

function downloadURL(collectionId: string, fileId: string) {
  return `/api/backend/api/v1/files/${encodeURIComponent(fileId)}/download?collectionId=${encodeURIComponent(collectionId)}`
}