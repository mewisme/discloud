"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { DownloadIcon, FileIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { apiRequest } from "@/lib/api/client"
import { filePreviewKind } from "@/lib/files/preview"

const textPreviewLimit = 256 * 1024

type PreviewFile = {
  id: string
  name: string
  size: number
  mimeType: string
  category?: string
}

export function FilePreview({ file, collectionId }: { file: PreviewFile; collectionId?: string }) {
  const kind = filePreviewKind(file.mimeType, file.category)
  const contentURL = fileContentURL(file.id, collectionId)

  switch (kind) {
    case "image":
      return (
        <div className="relative min-h-80 overflow-hidden rounded-xl border bg-muted/20 sm:h-[65vh]">
          <Image src={contentURL} alt={file.name} fill unoptimized sizes="(max-width: 768px) 100vw, 75vw" className="object-contain" />
        </div>
      )
    case "video":
      return (
        <div className="grid min-h-64 place-items-center overflow-hidden rounded-xl border bg-black">
          <video src={contentURL} controls preload="metadata" className="max-h-[70vh] w-full" />
        </div>
      )
    case "audio":
      return (
        <div className="grid min-h-40 place-items-center rounded-xl border bg-muted/20 p-6">
          <audio src={contentURL} controls preload="metadata" className="w-full max-w-2xl" />
        </div>
      )
    case "pdf":
      return <iframe src={contentURL} title={file.name} className="h-[70vh] w-full rounded-xl border bg-background" />
    case "text":
      return <TextPreview file={file} collectionId={collectionId} />
    default:
      return <UnsupportedPreview file={file} collectionId={collectionId} />
  }
}

function TextPreview({ file, collectionId }: { file: PreviewFile; collectionId?: string }) {
  const [text, setText] = useState("")
  const [loading, setLoading] = useState(file.size > 0)
  const [error, setError] = useState<string>()
  const truncated = file.size > textPreviewLimit

  useEffect(() => {
    if (file.size === 0) return

    const controller = new AbortController()
    const end = Math.min(file.size, textPreviewLimit) - 1

    async function load() {
      try {
        const response = await apiRequest(`/api/v1/files/${file.id}/content`, {
          query: collectionId ? { collectionId } : undefined,
          headers: { Range: `bytes=0-${end}` },
          signal: controller.signal,
        })
        setText(await response.text())
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : "Could not preview this file")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [collectionId, file.id, file.size])

  if (loading) {
    return (
      <div className="grid min-h-72 place-items-center rounded-xl border">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Loading preview…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Preview unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      {truncated && <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">Showing the first 256 KiB.</div>}
      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap wrap-break-word p-4 font-mono text-xs leading-relaxed">{text || "Empty file"}</pre>
    </div>
  )
}

function UnsupportedPreview({ file, collectionId }: { file: PreviewFile; collectionId?: string }) {
  return (
    <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div className="space-y-4">
        <FileIcon className="mx-auto size-10 text-muted-foreground" />
        <div>
          <p className="font-medium">Preview unavailable</p>
          <p className="text-sm text-muted-foreground">This file type is not previewed in the browser.</p>
        </div>
        <Button asChild>
          <a href={fileDownloadURL(file.id, collectionId)}>
            <DownloadIcon />
            Download file
          </a>
        </Button>
      </div>
    </div>
  )
}

function fileContentURL(fileId: string, collectionId?: string) {
  const base = `/api/backend/api/v1/files/${encodeURIComponent(fileId)}/content`
  return collectionId ? `${base}?collectionId=${encodeURIComponent(collectionId)}` : base
}

function fileDownloadURL(fileId: string, collectionId?: string) {
  const base = `/api/backend/api/v1/files/${encodeURIComponent(fileId)}/download`
  return collectionId ? `${base}?collectionId=${encodeURIComponent(collectionId)}` : base
}