"use client"

import { FolderIcon, PlayIcon } from "lucide-react"
import Image from "next/image"
import { useEffect, useState } from "react"

import { FileTypeIcon } from "@/components/files/file-type-icon"
import { apiDirectURL } from "@/lib/api/client"
import type { BrowserNode } from "@/lib/api/models"
import { loadThumbnail } from "@/lib/files/thumbnail-load"
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
    ? apiDirectURL(`/files/${encodeURIComponent(node.id)}/thumbnail`)
    : undefined
  const [source, setSource] = useState<string>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setSource(undefined)
    setFailed(false)

    if (!thumbnailURL) return

    const controller = new AbortController()

    void loadThumbnail(thumbnailURL, controller.signal)
      .then((nextSource) => {
        if (!controller.signal.aborted) setSource(nextSource)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })

    return () => controller.abort()
  }, [thumbnailURL])

  return (
    <div
      className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted", className)}
      aria-busy={!!thumbnailURL && !source && !failed}
    >
      {source && !failed ? (
        <>
          <Image
            src={source}
            alt=""
            fill
            unoptimized
            draggable={false}
            className="object-cover"
            onError={() => setFailed(true)}
          />

          {node.category === "video" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10">
              <span className="grid size-9 place-items-center rounded-full bg-black/55 text-white shadow-sm">
                <PlayIcon className="size-4 fill-current" />
              </span>
            </div>
          )}
        </>
      ) : node.kind === "folder" ? (
        <FolderIcon className={cn("text-muted-foreground", iconClassName)} aria-hidden />
      ) : (
        <FileTypeIcon
          category={node.category}
          className={cn("text-muted-foreground", iconClassName)}
          aria-hidden
        />
      )}
    </div>
  )
}