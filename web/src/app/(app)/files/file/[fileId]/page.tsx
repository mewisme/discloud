import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { FileDetail } from "@/components/files/file-detail"
import type { PreviewCarouselFile } from "@/components/files/file-preview-carousel"
import type { Breadcrumbs, File, FolderChildrenQuery, NodePage } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"
import { APIError } from "@/lib/api/types"
import { filePreviewKind } from "@/lib/files/preview"

export const metadata: Metadata = {
  title: "File",
}

export default async function FilePage({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params
  const data = await loadFile(fileId)

  return (
    <FileDetail
      file={data.file}
      breadcrumbs={data.breadcrumbs}
      previewFiles={data.previewFiles}
    />
  )
}

async function loadFile(fileId: string) {
  try {
    const file = await apiServerAuthJSON<File>(`/api/v1/files/${fileId}`)
    const [breadcrumbs, previewFiles] = await Promise.all([
      apiServerAuthJSON<Breadcrumbs>(`/api/v1/folders/${file.parentFolderId}/breadcrumbs`),
      loadPreviewFiles(file),
    ])

    return {
      file,
      breadcrumbs: breadcrumbs.breadcrumbs,
      previewFiles,
    }
  } catch (error) {
    if (error instanceof APIError && [403, 404].includes(error.status)) notFound()
    throw error
  }
}

async function loadPreviewFiles(file: File): Promise<PreviewCarouselFile[]> {
  if (filePreviewKind(file.mimeType, file.category) === "unsupported") return []

  const query = {
    limit: 100,
    sort: "name",
    order: "asc",
  } satisfies FolderChildrenQuery

  const page = await apiServerAuthJSON<NodePage>(
    `/api/v1/folders/${file.parentFolderId}/children`,
    { query },
  )

  const files = page.nodes.flatMap<PreviewCarouselFile>((node) => {
    if (node.kind !== "file") return []

    return [{
      id: node.id,
      name: node.name,
      size: node.size ?? 0,
      mimeType: node.mimeType ?? "application/octet-stream",
      category: node.category,
    }]
  })

  return files.some((candidate) => candidate.id === file.id) ? files : []
}