"use client"

import { DownloadIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"

import { useWorkspace } from "@/components/app/workspace-context"
import { CollectionFileIcon } from "@/components/collections/collection-file-icon"
import { DateOnly } from "@/components/common/date-time"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CollectionItem } from "@/lib/api/models"
import { collectionFilePath } from "@/lib/files/navigation"
import { formatBytes } from "@/lib/helpers"

export function CollectionItemsTable({
  collectionId,
  items,
  canEdit,
  onRemove,
}: {
  collectionId: string
  items: readonly CollectionItem[]
  canEdit: boolean
  onRemove: (fileId: string) => Promise<void>
}) {
  const workspace = useWorkspace()

  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Type</TableHead>
            <TableHead className="hidden sm:table-cell">Size</TableHead>
            <TableHead className="hidden lg:table-cell">Added</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>

        <TableBody>
          {items.map((item) => (
            <TableRow key={item.fileId}>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <CollectionFileIcon category={item.category} />
                  <Link
                    href={collectionFilePath(workspace.username, collectionId, item.fileId)}
                    className="truncate font-medium hover:underline"
                  >
                    {item.name}
                  </Link>
                </div>
              </TableCell>

              <TableCell className="hidden capitalize text-muted-foreground md:table-cell">
                {item.category || "File"}
              </TableCell>

              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {formatBytes(item.size)}
              </TableCell>

              <TableCell className="hidden text-muted-foreground lg:table-cell">
                <DateOnly value={item.addedAt} />
              </TableCell>

              <TableCell>
                <div className="flex justify-end">
                  <Button size="icon-sm" variant="ghost" asChild>
                    <a href={collectionDownloadURL(collectionId, item.fileId)} aria-label={`Download ${item.name}`}>
                      <DownloadIcon />
                    </a>
                  </Button>

                  {canEdit && (
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${item.name}`} onClick={() => void onRemove(item.fileId)}>
                      <Trash2Icon />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function collectionDownloadURL(collectionId: string, fileId: string) {
  return `/api/backend/api/v1/files/${encodeURIComponent(fileId)}/download?collectionId=${encodeURIComponent(collectionId)}`
}