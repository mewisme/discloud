import { FileDetailView } from "@discloud/app-ui/files/file-detail"
import { FilePreview } from "@discloud/app-ui/files/file-preview"
import { workspaceFolderPath, workspacePath } from "@discloud/shared/navigation"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Button } from "@discloud/ui/components/button"
import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useParams } from "react-router"

import { errorMessage } from "#lib/instance"

import { type DesktopFileDetailData, loadDesktopFileDetail } from "./api"
import { downloadNativeFile, nativeFileContentURL } from "./native"

type FileState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: DesktopFileDetailData }

export function DesktopFilePage() {
  const { username, fileId } = useParams()
  const [state, setState] = useState<FileState>({ status: "loading" })
  const [reloadVersion, setReloadVersion] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string>()

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!username || !fileId) {
        setState({ status: "error", message: "Workspace username or file ID is missing." })
        return
      }

      setState({ status: "loading" })
      setDownloadError(undefined)

      try {
        const data = await loadDesktopFileDetail(username, fileId)
        if (!cancelled) setState({ status: "ready", data })
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [username, fileId, reloadVersion])

  async function download() {
    if (state.status !== "ready" || downloading) return

    setDownloading(true)
    setDownloadError(undefined)

    try {
      await downloadNativeFile(state.data.file)
    } catch (error) {
      setDownloadError(errorMessage(error))
    } finally {
      setDownloading(false)
    }
  }

  if (state.status === "loading") return <FileLoading />
  if (state.status === "error") return <FileError message={state.message} onRetry={() => setReloadVersion((value) => value + 1)} />

  const { data } = state
  const workspaceUsername = data.workspace.owner.username
  const parent = data.breadcrumbs.at(-1)
  const parentPath = parent?.isRoot ? workspacePath(workspaceUsername) : parent ? workspaceFolderPath(workspaceUsername, parent.id) : workspacePath(workspaceUsername)
  const breadcrumbItems = [
    ...data.breadcrumbs.map((item) => ({
      id: item.id,
      label: item.isRoot ? `${data.workspace.owner.name}'s Workspace` : item.name,
      href: hashPath(item.isRoot ? workspacePath(workspaceUsername) : workspaceFolderPath(workspaceUsername, item.id)),
      isRoot: item.isRoot,
    })),
    { id: `file:${data.file.id}`, label: data.file.name },
  ]

  return (
    <FileDetailView
      file={data.file}
      breadcrumbs={breadcrumbItems}
      parentHref={hashPath(parentPath)}
      downloading={downloading}
      downloadError={downloadError}
      onDownload={download}
      preview={
        <FilePreview
          file={data.file}
          contentURL={nativeFileContentURL(data.file.id)}
          downloading={downloading}
          onDownload={download}
        />
      }
    />
  )
}

function FileLoading() {
  return (
    <div className="grid min-h-64 place-items-center">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        Loading file
      </div>
    </div>
  )
}

function FileError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Could not load file</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{message}</span>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>Try again</Button>
      </AlertDescription>
    </Alert>
  )
}

function hashPath(path: string) {
  return `#${path}`
}