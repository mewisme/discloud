import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { FileDetail } from "@/components/files/file-detail"
import type { Breadcrumbs, File } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"
import { APIError } from "@/lib/api/types"

export const metadata: Metadata = {
  title: "File",
}

export default async function FilePage({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params
  const data = await loadFile(fileId)
  return <FileDetail file={data.file} breadcrumbs={data.breadcrumbs} />
}

async function loadFile(fileId: string) {
  try {
    const file = await apiServerAuthJSON<File>(`/api/v1/files/${fileId}`)
    const breadcrumbs = await apiServerAuthJSON<Breadcrumbs>(`/api/v1/folders/${file.parentFolderId}/breadcrumbs`)
    return { file, breadcrumbs: breadcrumbs.breadcrumbs }
  } catch (error) {
    if (error instanceof APIError && [403, 404].includes(error.status)) notFound()
    throw error
  }
}