"use client"

import { Button } from "@discloud/ui/components/button"
import { DownloadIcon, FolderIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { CompactBreadcrumbs } from "@/components/navigation/compact-breadcrumbs"
import { PublicEntriesTable } from "@/components/shares/public/public-entries-table"
import { PublicPreviewDialog } from "@/components/shares/public/public-preview-dialog"
import { PublicResourceHeading } from "@/components/shares/public/public-share-shell"
import { apiJSON, apiURL } from "@/lib/api/client"
import type { PublicFolder, PublicNode } from "@/lib/api/models"
import { apiErrorMessage } from "@/lib/helpers"
import { publicFolderDownloadPath, publicFolderPath } from "@/lib/shares/public"

export function PublicFolderView({
  publicId,
  root,
  allowDownload,
}: {
  publicId: string
  root: PublicFolder
  allowDownload: boolean
}) {
  const [path, setPath] = useState<PublicFolder[]>([root])
  const [preview, setPreview] = useState<PublicNode>()
  const [loading, setLoading] = useState(false)
  const current = path[path.length - 1]
  const breadcrumbs = path.map((folder, index) => ({
    id: folder.id,
    label: folder.name || (index === 0 ? "Shared folder" : "Folder"),
  }))

  async function openFolder(node: PublicNode) {
    if (loading) return
    setLoading(true)

    try {
      const folder = await apiJSON<PublicFolder>(
        publicFolderPath(publicId, node.id),
      )
      setPath((currentPath) => [...currentPath, folder])
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not open this folder"))
    } finally {
      setLoading(false)
    }
  }

  function navigateBreadcrumb(folderId: string) {
    const index = path.findIndex((folder) => folder.id === folderId)
    if (index >= 0) {
      setPath((currentPath) => currentPath.slice(0, index + 1))
    }
  }

  return (
    <div className="space-y-5">
      <CompactBreadcrumbs
        items={breadcrumbs}
        onNavigate={(item) => navigateBreadcrumb(item.id)}
      />

      <PublicResourceHeading
        icon={<FolderIcon className="size-5" />}
        title={current.name || "Shared folder"}
        description={`${current.children.length} item${current.children.length === 1 ? "" : "s"}`}
        action={allowDownload ? (
          <Button variant="outline" asChild>
            <a href={apiURL(publicFolderDownloadPath(publicId, current.id))}>
              <DownloadIcon />
              Download folder
            </a>
          </Button>
        ) : undefined}
      />

      <PublicEntriesTable
        publicId={publicId}
        entries={current.children}
        allowDownload={allowDownload}
        loading={loading}
        parent={
          path.length > 1
            ? () => setPath((currentPath) => currentPath.slice(0, -1))
            : undefined
        }
        onOpenFolder={openFolder}
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