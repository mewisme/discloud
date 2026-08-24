import type { BrowserNode } from "@discloud/api/models"
import { FileNodeVisual } from "@discloud/app-ui/files/file-node-visual"
import { cn } from "@discloud/ui/lib/utils"
import { convertFileSrc } from "@tauri-apps/api/core"
import { PlayIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

const canonicalAttempts = 7

export function DesktopFileNodeVisual({ node, localThumbnailKey, className, iconClassName }: { node: BrowserNode; localThumbnailKey?: string; className?: string; iconClassName?: string }) {
  const localURL = useMemo(() => localThumbnailKey ? convertFileSrc(`local/${encodeURIComponent(localThumbnailKey)}`, "discloud-thumbnail") : undefined, [localThumbnailKey])
  const canonicalURL = node.kind === "file" && (node.thumbnailStatus === "ready" || localURL || ["image", "video", "audio"].includes(node.category ?? ""))
    ? convertFileSrc(`files/${encodeURIComponent(node.id)}`, "discloud-thumbnail")
    : undefined
  const [source, setSource] = useState(localURL)

  useEffect(() => {
    setSource((current) => current && current !== localURL ? current : localURL)
    if (!canonicalURL) return

    const controller = new AbortController()
    void preloadCanonical(canonicalURL, controller.signal, localURL ? canonicalAttempts : 1)
      .then((loaded) => {
        if (!controller.signal.aborted) setSource(loaded)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [canonicalURL, localURL])

  if (!source) return <FileNodeVisual node={node} className={className} iconClassName={iconClassName} />

  return (
    <div className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted", className)}>
      <img src={source} alt="" draggable={false} className="size-full object-cover" onError={() => setSource(source === localURL ? undefined : localURL)} />
      {node.category === "video" ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10">
          <span className="grid size-9 place-items-center rounded-full bg-black/55 text-white shadow-sm">
            <PlayIcon className="size-4 fill-current" />
          </span>
        </div>
      ) : null}
    </div>
  )
}

async function preloadCanonical(baseURL: string, signal: AbortSignal, attempts: number) {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal.aborted) throw signal.reason
    if (attempt > 0) await delay(Math.min(4000, 350 * 2 ** (attempt - 1)), signal)
    const source = retryURL(baseURL, attempt)
    try {
      await decodeImage(source, signal)
      return source
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Canonical thumbnail is unavailable")
}

function decodeImage(source: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const image = new Image()
    const abort = () => { image.src = ""; reject(signal.reason) }
    image.onload = () => { signal.removeEventListener("abort", abort); image.decode().then(resolve, reject) }
    image.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error("Thumbnail request failed")) }
    signal.addEventListener("abort", abort, { once: true })
    image.src = source
  })
}

function retryURL(baseURL: string, attempt: number) {
  if (!attempt) return baseURL
  const url = new URL(baseURL)
  url.searchParams.set("_thumbnailRetry", String(attempt))
  return url.toString()
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const timer = window.setTimeout(() => { signal.removeEventListener("abort", abort); resolve() }, ms)
    const abort = () => { window.clearTimeout(timer); reject(signal.reason) }
    signal.addEventListener("abort", abort, { once: true })
  })
}
