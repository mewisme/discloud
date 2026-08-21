import type { Metadata } from "next"

import { FileBrowser } from "@/components/files/file-browser"
import { type BrowserSearchParams, parseBrowserOptions } from "@/lib/files/browser"
import { loadFileBrowser } from "@/lib/files/browser-server"
import { getWorkspace } from "@/lib/workspace/server"

export const metadata: Metadata = {
  title: "Files",
}

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>
  searchParams: Promise<BrowserSearchParams>
}) {
  const [{ username }, query] = await Promise.all([
    params,
    searchParams,
  ])
  const options = parseBrowserOptions(query)
  const workspace = await getWorkspace(username)
  const data = await loadFileBrowser(workspace.root.id, options)

  return (
    <FileBrowser
      folder={data.folder}
      breadcrumbs={data.breadcrumbs}
      initialPage={data.page}
      options={options}
    />
  )
}