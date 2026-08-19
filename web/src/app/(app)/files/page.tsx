import type { Metadata } from "next"
import { FileBrowser } from "@/components/files/file-browser"
import { parseBrowserOptions, type BrowserSearchParams } from "@/lib/files/browser"
import { loadFileBrowser } from "@/lib/files/browser-server"

export const metadata: Metadata = {
  title: "Files",
}

export default async function FilesPage({ searchParams }: { searchParams: Promise<BrowserSearchParams> }) {
  const options = parseBrowserOptions(await searchParams)
  const data = await loadFileBrowser(undefined, options)

  return <FileBrowser folder={data.folder} breadcrumbs={data.breadcrumbs} initialPage={data.page} options={options} />
}