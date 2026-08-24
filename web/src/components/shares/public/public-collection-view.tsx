"use client"

import { LibraryIcon } from "lucide-react"
import { useState } from "react"

import { PublicEntriesTable } from "@/components/shares/public/public-entries-table"
import { PublicPreviewDialog } from "@/components/shares/public/public-preview-dialog"
import { PublicResourceHeading } from "@/components/shares/public/public-share-shell"
import type { PublicNode, PublicShare } from "@/lib/api/models"

type PublicCollection = NonNullable<PublicShare["collection"]>

export function PublicCollectionView({
  publicId,
  collection,
  allowDownload,
}: {
  publicId: string
  collection: PublicCollection
  allowDownload: boolean
}) {
  const [preview, setPreview] = useState<PublicNode>()

  return (
    <div className="space-y-5">
      <PublicResourceHeading
        icon={<LibraryIcon className="size-5" />}
        title={collection.name}
        description={
          collection.description
          || `${collection.items.length} shared file${collection.items.length === 1 ? "" : "s"}`
        }
      />

      <PublicEntriesTable
        publicId={publicId}
        entries={collection.items}
        allowDownload={allowDownload}
        onOpenFile={setPreview}
      />

      <PublicPreviewDialog
        publicId={publicId}
        file={preview}
        allowDownload={allowDownload}
        onOpenChange={(open) => {
          if (!open) setPreview(undefined)
        }}
      />
    </div>
  )
}