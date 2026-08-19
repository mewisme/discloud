import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { AccessDialog } from "@/components/access/access-dialog"
import { FileBrowser } from "@/components/files/file-browser"
import { FileUploadTarget } from "@/components/uploads/upload-target"
import { APIError } from "@/lib/api/types"
import { parseBrowserOptions, type BrowserOptions, type BrowserSearchParams } from "@/lib/files/browser"
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

  return (
    <>
      {data.page.accessLevel === "full" && (
        <div className="mx-auto mb-3 flex w-full max-w-7xl justify-end">
          <AccessDialog resource={{ type: "folder", id: data.folder.id, name: data.folder.name }} />
        </div>
      )}
      <FileUploadTarget folderId={data.folder.id} disabled={data.page.accessLevel === "view"}>
        <FileBrowser
          key={`${data.folder.id}:${options.sort}:${options.order}`}
          folder={data.folder}
          breadcrumbs={data.breadcrumbs}
          initialPage={data.page}
          options={options}
        />
      </FileUploadTarget>
    </>
  )
}

async function loadFolder(folderId: string, options: BrowserOptions) {
  try {
    return await loadFileBrowser(folderId, options)
  } catch (error) {
    if (error instanceof APIError && [403, 404, 409].includes(error.status)) notFound()
    throw error
  }
}