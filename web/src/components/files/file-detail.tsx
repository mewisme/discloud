"use client"

import { FileDetailView } from "@discloud/app-ui/files/file-detail"

import { useWorkspace } from "@/components/app/workspace-context"
import { FilePreviewCarousel, type PreviewCarouselFile } from "@/components/files/file-preview-carousel"
import { WebFileVersionHistory } from "@/components/files/file-version-history"
import type { File, Node } from "@/lib/api/models"
import { folderBrowserPath, workspacePath } from "@/lib/files/navigation"

export function FileDetail({ file, breadcrumbs, previewFiles }: { file: File; breadcrumbs: readonly Node[]; previewFiles: readonly PreviewCarouselFile[] }) {
  const workspace = useWorkspace()
  const parent = breadcrumbs.at(-1)
  const parentHref = parent?.isRoot ? folderBrowserPath(workspace.username) : parent ? folderBrowserPath(workspace.username, parent.id) : folderBrowserPath(workspace.username)
  const breadcrumbItems = [
    ...breadcrumbs.map((item) => ({
      id: item.id,
      label: item.isRoot ? `${workspace.name}'s Workspace` : item.name,
      href: folderBrowserPath(workspace.username, item.isRoot ? undefined : item.id),
      isRoot: item.isRoot,
    })),
    { id: `file:${file.id}`, label: file.name },
  ]

  return (
    <FileDetailView
      file={file}
      breadcrumbs={breadcrumbItems}
      parentHref={parentHref}
      downloadHref={`/api/backend/api/v1/files/${encodeURIComponent(file.id)}/download`}
      preview={<FilePreviewCarousel currentFile={file} files={previewFiles} routeBase={workspacePath(workspace.username, "files")} />}
      versionHistory={<WebFileVersionHistory fileId={file.id} />}
    />
  )
}