"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FileTextIcon, FileVideoIcon, FolderIcon, PlayIcon } from "lucide-react"
import { apiURL } from "@/lib/api/client"
import type { BrowserNode } from "@/lib/api/models"
import { acquireThumbnailLoadSlot, canRetryThumbnail, thumbnailAttemptURL, waitForThumbnailRetry } from "@/lib/files/thumbnail-load"
import { cn } from "@/lib/utils"

export function FileNodeVisual({
  node,
  className,
  iconClassName = "size-4",
}: {
  node: BrowserNode
  className?: string
  iconClassName?: string
}) {
  const thumbnailURL = node.kind === "file" && node.thumbnailStatus === "ready"
    ? apiURL(`/files/${encodeURIComponent(node.id)}/thumbnail`)
    : undefined
  const releaseRef = useRef<(() => void) | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const [source, setSource] = useState<string>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setAttempt(0)
    setSource(undefined)
    setFailed(false)
  }, [thumbnailURL])

  useEffect(() => {
    if (!thumbnailURL || failed) return

    const controller = new AbortController()
    let release: (() => void) | undefined

    void (async () => {
      try {
        setSource(undefined)

        if (attempt > 0) {
          await waitForThumbnailRetry(attempt, controller.signal)
        }

        release = await acquireThumbnailLoadSlot(controller.signal)
        releaseRef.current = release

        if (!controller.signal.aborted) {
          setSource(thumbnailAttemptURL(thumbnailURL, attempt))
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      }
    })()

    return () => {
      controller.abort()
      release?.()
      if (releaseRef.current === release) releaseRef.current = undefined
    }
  }, [attempt, failed, thumbnailURL])

  function releaseSlot() {
    releaseRef.current?.()
    releaseRef.current = undefined
  }

  function thumbnailLoaded() {
    releaseSlot()
  }

  function thumbnailFailed() {
    releaseSlot()

    if (canRetryThumbnail(attempt)) {
      setAttempt((current) => current + 1)
      return
    }

    setFailed(true)
  }

  return (
    <div className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted", className)}>
      {source && !failed ? (
        <>
          <Image
            src={source}
            alt=""
            fill
            unoptimized
            loading="eager"
            draggable={false}
            className="object-cover"
            onLoad={thumbnailLoaded}
            onError={thumbnailFailed}
          />

          {node.category === "video" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10">
              <span className="grid size-9 place-items-center rounded-full bg-black/55 text-white shadow-sm">
                <PlayIcon className="size-4 fill-current" />
              </span>
            </div>
          )}
        </>
      ) : (
        <NodeIcon node={node} className={cn("text-muted-foreground", iconClassName)} />
      )}
    </div>
  )
}

function NodeIcon({ node, className }: { node: BrowserNode; className?: string }) {
  if (node.kind === "folder") return <FolderIcon className={className} aria-hidden />

  switch (node.category) {
    case "image":
      return <FileImageIcon className={className} aria-hidden />
    case "video":
      return <FileVideoIcon className={className} aria-hidden />
    case "audio":
      return <FileAudioIcon className={className} aria-hidden />
    case "document":
    case "text":
      return <FileTextIcon className={className} aria-hidden />
    case "archive":
      return <FileArchiveIcon className={className} aria-hidden />
    default:
      return <FileIcon className={className} aria-hidden />
  }
}