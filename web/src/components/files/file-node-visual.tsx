"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { FileArchiveIcon, FileAudioIcon, FileIcon, FileImageIcon, FileTextIcon, FileVideoIcon, FolderIcon, PlayIcon } from "lucide-react"
import { apiURL } from "@/lib/api/client"
import type { BrowserNode } from "@/lib/api/models"
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
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [thumbnailURL])

  return (
    <div className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted", className)}>
      {thumbnailURL && !failed ? (
        <>
          <Image
            src={thumbnailURL}
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