"use client"

import { filePreviewKind } from "@discloud/shared/file-preview"
import { cn } from "@discloud/ui/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@discloud/ui/components/alert"
import { Button } from "@discloud/ui/components/button"
import { Spinner } from "@discloud/ui/components/spinner"
import { DownloadIcon, FileIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"

const textPreviewLimit = 256 * 1024

export type PreviewFile = {
  id: string
  name: string
  size: number
  mimeType: string
  category?: string
}

export function FilePreview({
  file,
  contentURL,
  downloading = false,
  onDownload,
}: {
  file: PreviewFile
  contentURL: string
  downloading?: boolean
  onDownload?: () => void | Promise<void>
}) {
  switch (filePreviewKind(file.mimeType, file.category)) {
    case "image":
      return <ImagePreview file={file} contentURL={contentURL} />
    case "video":
      return <VideoPreview file={file} contentURL={contentURL} />
    case "audio":
      return <AudioPreview contentURL={contentURL} />
    case "pdf":
      return <PDFPreview file={file} contentURL={contentURL} />
    case "text":
      return <TextPreview file={file} contentURL={contentURL} />
    default:
      return <UnsupportedPreview file={file} downloading={downloading} onDownload={onDownload} />
  }
}

function ImagePreview({ file, contentURL }: { file: PreviewFile; contentURL: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(false)
  }, [contentURL, retryKey])

  return (
    <div className="relative min-h-80 overflow-hidden rounded-xl border bg-muted/20 sm:h-[70vh]">
      {loading && !error ? (
        <div className="absolute inset-0 z-10 grid place-items-center">
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-6" />
            <span>Loading image…</span>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <TriangleAlertIcon className="size-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">Preview unavailable</p>
              <p className="text-sm text-muted-foreground">The image could not be loaded.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setRetryKey((value) => value + 1)}>
              <RefreshCwIcon />
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <img
          key={`${contentURL}-${retryKey}`}
          src={contentURL}
          alt={file.name}
          draggable={false}
          className={cn("absolute inset-0 size-full object-contain transition-opacity duration-200", loading ? "opacity-0" : "opacity-100")}
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false)
            setError(true)
          }}
        />
      )}
    </div>
  )
}

function VideoPreview({ file, contentURL }: { file: PreviewFile; contentURL: string }) {
  return (
    <div className="grid min-h-64 place-items-center overflow-hidden rounded-xl border bg-black">
      <video src={contentURL} title={file.name} controls preload="metadata" className="max-h-[75vh] w-full" />
    </div>
  )
}

function AudioPreview({ contentURL }: { contentURL: string }) {
  return (
    <div className="grid min-h-48 place-items-center rounded-xl border bg-muted/20 p-6">
      <audio src={contentURL} controls preload="metadata" className="w-full max-w-2xl" />
    </div>
  )
}

function PDFPreview({ file, contentURL }: { file: PreviewFile; contentURL: string }) {
  return <iframe src={contentURL} title={file.name} className="h-[75vh] w-full rounded-xl border bg-background" />
}

function TextPreview({ file, contentURL }: { file: PreviewFile; contentURL: string }) {
  const [text, setText] = useState("")
  const [loading, setLoading] = useState(file.size > 0)
  const [error, setError] = useState<string>()
  const [retryKey, setRetryKey] = useState(0)
  const truncated = file.size > textPreviewLimit

  useEffect(() => {
    if (file.size === 0) {
      setText("")
      setLoading(false)
      setError(undefined)
      return
    }

    const controller = new AbortController()
    const end = Math.min(file.size, textPreviewLimit) - 1

    setLoading(true)
    setError(undefined)

    async function load() {
      try {
        const response = await fetch(contentURL, { headers: { Range: `bytes=0-${end}` }, signal: controller.signal })
        if (!response.ok) throw new Error(`Preview request failed (${response.status})`)
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
  }, [contentURL, file.size, retryKey])

  if (loading) {
    return (
      <div className="grid min-h-72 place-items-center rounded-xl border">
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner aria-hidden />
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
        <AlertDescription className="space-y-3">
          <p>{error}</p>
          <Button size="sm" variant="outline" onClick={() => setRetryKey((value) => value + 1)}>
            <RefreshCwIcon />
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {truncated ? <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">Showing the first 256 KiB.</div> : null}
      <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap wrap-break-word p-4 font-mono text-xs leading-relaxed">{text || "Empty file"}</pre>
    </div>
  )
}

function UnsupportedPreview({ file, downloading, onDownload }: { file: PreviewFile; downloading: boolean; onDownload?: () => void | Promise<void> }) {
  return (
    <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div className="space-y-4">
        <FileIcon className="mx-auto size-10 text-muted-foreground" />
        <div>
          <p className="font-medium">Preview unavailable</p>
          <p className="text-sm text-muted-foreground">{file.name} cannot be previewed here.</p>
        </div>
        <Button disabled={downloading || !onDownload} onClick={() => void onDownload?.()}>
          {downloading ? <Spinner /> : <DownloadIcon />}
          {downloading ? "Downloading..." : "Download file"}
        </Button>
      </div>
    </div>
  )
}