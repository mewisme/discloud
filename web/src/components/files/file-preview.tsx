"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { DownloadIcon, FileIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest, apiURL } from "@/lib/api/client"
import { filePreviewKind } from "@/lib/files/preview"
import { cn } from "@/lib/utils"

const textPreviewLimit = 256 * 1024

type PreviewFile = {
  id: string
  name: string
  size: number
  mimeType: string
  category?: string
}

export type FilePreviewSource = {
  contentPath: string
  downloadPath: string
}

export function FilePreview({ file, collectionId, source: customSource }: { file: PreviewFile; collectionId?: string; source?: FilePreviewSource }) {
  const kind = filePreviewKind(file.mimeType, file.category)
  const source = customSource ?? structuralSource(file.id, collectionId)
  const contentURL = apiURL(source.contentPath)

  switch (kind) {
    case "image":
      return <ImagePreview file={file} contentURL={contentURL} />
    case "video":
      return (
        <div className="grid min-h-64 place-items-center overflow-hidden rounded-xl border bg-black">
          <video src={contentURL} controls preload="metadata" className="max-h-[75vh] w-full" />
        </div>
      )
    case "audio":
      return (
        <div className="grid min-h-48 place-items-center rounded-xl border bg-muted/20 p-6">
          <audio src={contentURL} controls preload="metadata" className="w-full max-w-2xl" />
        </div>
      )
    case "pdf":
      return <iframe src={contentURL} title={file.name} className="h-[75vh] w-full rounded-xl border bg-background" />
    case "text":
      return <TextPreview file={file} source={source} />
    default:
      return <UnsupportedPreview file={file} source={source} />
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
      {loading && !error && (
        <div className="absolute inset-0 z-10 grid place-items-center">
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-6" />
            <span>Loading image…</span>
          </div>
        </div>
      )}

      {error ? (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <TriangleAlertIcon className="size-8 text-muted-foreground" />

            <div className="space-y-1">
              <p className="font-medium">Preview unavailable</p>
              <p className="text-sm text-muted-foreground">The image could not be loaded.</p>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setRetryKey((current) => current + 1)}
            >
              <RefreshCwIcon />
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <Image
          key={`${contentURL}-${retryKey}`}
          src={contentURL}
          alt={file.name}
          fill
          unoptimized
          sizes="(max-width: 768px) 100vw, 75vw"
          loading="eager"
          className={cn(
            "object-contain transition-opacity duration-200",
            loading ? "opacity-0" : "opacity-100",
          )}
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

function TextPreview({ file, source }: { file: PreviewFile; source: FilePreviewSource }) {
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
        const response = await apiRequest(source.contentPath, {
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
  }, [file.size, retryKey, source.contentPath])

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
          <Button size="sm" variant="outline" onClick={() => setRetryKey((current) => current + 1)}>
            <RefreshCwIcon />
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {truncated && <div className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">Showing the first 256 KiB.</div>}
      <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap wrap-break-word p-4 font-mono text-xs leading-relaxed">{text || "Empty file"}</pre>
    </div>
  )
}

function UnsupportedPreview({ file, source }: { file: PreviewFile; source: FilePreviewSource }) {
  return (
    <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-6 text-center">
      <div className="space-y-4">
        <FileIcon className="mx-auto size-10 text-muted-foreground" />
        <div>
          <p className="font-medium">Preview unavailable</p>
          <p className="text-sm text-muted-foreground">{file.name} cannot be previewed in the browser.</p>
        </div>
        <Button asChild>
          <a href={apiURL(source.downloadPath)}>
            <DownloadIcon />
            Download file
          </a>
        </Button>
      </div>
    </div>
  )
}

function structuralSource(fileId: string, collectionId?: string): FilePreviewSource {
  const suffix = collectionId ? `?collectionId=${encodeURIComponent(collectionId)}` : ""
  const encoded = encodeURIComponent(fileId)

  return {
    contentPath: `/api/v1/files/${encoded}/content${suffix}`,
    downloadPath: `/api/v1/files/${encoded}/download${suffix}`,
  }
}