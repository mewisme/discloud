import type { Collection, CollectionItem, CollectionItems } from "@discloud/api/models"
import { FileBreadcrumbs } from "@discloud/app-ui/files/file-breadcrumbs"
import { FilePreview } from "@discloud/app-ui/files/file-preview"
import { formatBytes, formatDate } from "@discloud/shared/format"
import { workspaceCollectionPath } from "@discloud/shared/navigation"
import { Button } from "@discloud/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@discloud/ui/components/card"
import { DownloadIcon, FileIcon, LibraryIcon, Loader2Icon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { Link, useParams } from "react-router"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { downloadNativeFile, nativeFileContentURL } from "../files/native"

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; collection: Collection; item: CollectionItem }

export function DesktopCollectionFilePage() {
  const { username, collectionId, fileId } = useParams()
  const [state, setState] = useState<State>({ status: "loading" })
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string>()

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!collectionId || !fileId) {
        setState({ status: "error", message: "Collection or file ID is missing." })
        return
      }

      try {
        const [collection, items] = await Promise.all([
          apiJSON<Collection>(`/api/v1/collections/${encodeURIComponent(collectionId)}`),
          apiJSON<CollectionItems>(`/api/v1/collections/${encodeURIComponent(collectionId)}/items`),
        ])
        const item = items.items.find((candidate) => candidate.fileId === fileId)

        if (!item) throw new Error("File is not part of this collection.")
        if (!cancelled) setState({ status: "ready", collection, item })
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [collectionId, fileId])

  async function download() {
    if (state.status !== "ready" || downloading) return

    setDownloading(true)
    setDownloadError(undefined)

    try {
      await downloadNativeFile({ id: state.item.fileId, name: state.item.name }, state.collection.id)
    } catch (error) {
      setDownloadError(errorMessage(error))
    } finally {
      setDownloading(false)
    }
  }

  if (state.status === "loading") return <div className="grid min-h-64 place-items-center"><Loader2Icon className="animate-spin text-muted-foreground" /></div>
  if (state.status === "error" || !username) return <p role="alert" className="text-sm text-destructive">{state.status === "error" ? state.message : "Workspace username is missing."}</p>

  const collectionPath = workspaceCollectionPath(username, state.collection.id)

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <FileBreadcrumbs items={[
        { id: "collections", label: "Collections", href: `#${workspaceCollectionPath(username)}` },
        { id: `collection:${state.collection.id}`, label: state.collection.name, href: `#${collectionPath}` },
        { id: `file:${state.item.fileId}`, label: state.item.name },
      ]} />

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileIcon className="size-5 shrink-0" />
            <h1 className="truncate text-2xl font-semibold tracking-tight">{state.item.name}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{formatBytes(state.item.size)} · {state.item.mimeType}</p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to={collectionPath}><LibraryIcon />Collection</Link>
          </Button>

          <Button disabled={downloading} onClick={() => void download()}>
            {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
            {downloading ? "Downloading…" : "Download"}
          </Button>
        </div>
      </div>

      {downloadError ? <p role="alert" className="text-sm text-destructive">{downloadError}</p> : null}

      <FilePreview
        file={{ id: state.item.fileId, name: state.item.name, size: state.item.size, mimeType: state.item.mimeType, category: state.item.category }}
        contentURL={nativeFileContentURL(state.item.fileId, state.collection.id)}
        downloading={downloading}
        onDownload={download}
      />

      <Card>
        <CardHeader><CardTitle>File details</CardTitle></CardHeader>
        <CardContent className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Type" value={state.item.category || "File"} />
          <Detail label="MIME type" value={state.item.mimeType} />
          <Detail label="Size" value={formatBytes(state.item.size)} />
          <Detail label="Added" value={formatDate(state.item.addedAt)} />
          <Detail label="Created" value={formatDate(state.item.createdAt)} />
          <Detail label="Modified" value={formatDate(state.item.updatedAt)} />
          {state.item.sha256 ? <Detail className="sm:col-span-2 lg:col-span-3" label="SHA-256" value={<code className="break-all font-mono text-xs">{state.item.sha256}</code>} /> : null}
        </CardContent>
      </Card>
    </div>
  )
}

function Detail({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  )
}