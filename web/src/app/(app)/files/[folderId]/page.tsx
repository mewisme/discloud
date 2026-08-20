import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { FileBrowser } from "@/components/files/file-browser"
import { APIError } from "@/lib/api/types"
import { type BrowserOptions, type BrowserSearchParams,parseBrowserOptions } from "@/lib/files/browser"
import { loadFileBrowser } from "@/lib/files/browser-server"

export const metadata: Metadata = {
  title: "Files",
}

export default async function FolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ folderId: string }>
  searchParams: Promise<BrowserSearchParams>
}) {
  const [{ folderId }, query] = await Promise.all([params, searchParams])
  const options = parseBrowserOptions(query)
  const data = await loadFolder(folderId, options)

  return <FileBrowser folder={data.folder} breadcrumbs={data.breadcrumbs} initialPage={data.page} options={options} />
}

async function loadFolder(folderId: string, options: BrowserOptions) {
  try {
    return await loadFileBrowser(folderId, options)
  } catch (error) {
    if (error instanceof APIError && [403, 404, 409].includes(error.status)) notFound()
    throw error
  }
}