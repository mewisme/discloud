import { Button } from "@discloud/ui/components/button"
import { DownloadIcon, FileIcon } from "lucide-react"

import { FilePreview } from "@/components/files/file-preview"
import { PublicInfo, PublicResourceHeading } from "@/components/shares/public/public-share-shell"
import type { PublicShare } from "@/lib/api/models"
import { apiURL } from "@/lib/api/path"
import { formatBytes, formatDate } from "@/lib/helpers"
import { publicFileContentPath, publicFileDownloadPath } from "@/lib/shares/public"

type PublicFile = NonNullable<PublicShare["file"]>

export function PublicFileView({
  publicId,
  file,
}: {
  publicId: string
  file: PublicFile
}) {
  const source = {
    contentPath: publicFileContentPath(publicId),
    downloadPath: publicFileDownloadPath(publicId),
  }

  return (
    <div className="space-y-5">
      <PublicResourceHeading
        icon={<FileIcon className="size-5" />}
        title={file.name}
        description="Shared file"
        action={
          <Button asChild>
            <a href={apiURL(source.downloadPath)}>
              <DownloadIcon />
              Download
            </a>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        <PublicInfo label="Size" value={formatBytes(file.size)} />
        <PublicInfo label="Type" value={file.mimeType} />
        <PublicInfo label="Modified" value={formatDate(file.updatedAt)} />
        <PublicInfo
          label="SHA-256"
          value={file.sha256 ? `${file.sha256.slice(0, 12)}…` : "—"}
          mono
        />
      </div>

      <FilePreview
        file={{
          id: file.id,
          name: file.name,
          size: file.size,
          mimeType: file.mimeType,
          category: file.category,
        }}
        source={source}
      />
    </div>
  )
}