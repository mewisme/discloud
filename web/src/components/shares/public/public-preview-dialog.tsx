"use client"

import { Button } from "@discloud/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@discloud/ui/components/dialog"
import { DownloadIcon } from "lucide-react"

import { FilePreview } from "@/components/files/file-preview"
import { apiURL } from "@/lib/api/client"
import type { PublicNode } from "@/lib/api/models"
import { formatBytes } from "@/lib/helpers"
import { publicFileContentPath, publicFileDownloadPath } from "@/lib/shares/public"

export function PublicPreviewDialog({
  publicId,
  file,
  onOpenChange,
}: {
  publicId: string
  file?: PublicNode
  onOpenChange: (open: boolean) => void
}) {
  if (!file) return null

  const source = {
    contentPath: publicFileContentPath(publicId, file.id),
    downloadPath: publicFileDownloadPath(publicId, file.id),
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{file.name}</DialogTitle>
          <DialogDescription>
            {file.size != null ? formatBytes(file.size) : "File"} · {file.mimeType || "Unknown type"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button size="sm" variant="outline" asChild>
            <a href={apiURL(source.downloadPath)}>
              <DownloadIcon />
              Download
            </a>
          </Button>
        </div>

        <FilePreview
          file={{
            id: file.id,
            name: file.name,
            size: file.size ?? 0,
            mimeType: file.mimeType || "application/octet-stream",
            category: file.category,
          }}
          source={source}
        />
      </DialogContent>
    </Dialog>
  )
}