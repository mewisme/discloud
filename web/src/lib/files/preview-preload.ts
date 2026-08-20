import "client-only"

import { apiURL } from "@/lib/api/client"
import { filePreviewKind } from "@/lib/files/preview"

const maxConcurrentPreviewWarms = 3
const maxRememberedWarmAssets = 256
const previewWarmRangeEnd = 256 * 1024 - 1

export type PreviewPreloadAsset = {
  id: string
  mimeType: string
  category?: string
}

type PreviewWarmTask = {
  source: string
  kind: ReturnType<typeof filePreviewKind>
}

const preloadWindows = new Map<symbol, Set<string>>()
const warmedPreviewAssets = new Set<string>()
const activePreviewWarms = new Map<string, Promise<void>>()
let pendingPreviewWarms: PreviewWarmTask[] = []

export function setPreviewPreloadWindow(
  owner: symbol,
  files: readonly PreviewPreloadAsset[],
  collectionId?: string,
) {
  const tasks = files.map((file) => previewWarmTask(file, collectionId))
  preloadWindows.set(owner, new Set(tasks.map((task) => task.source)))
  removeUndesiredPendingWarms()

  const pendingSources = new Set(pendingPreviewWarms.map((task) => task.source))

  for (const task of tasks) {
    if (
      warmedPreviewAssets.has(task.source) ||
      activePreviewWarms.has(task.source) ||
      pendingSources.has(task.source)
    ) {
      continue
    }

    pendingPreviewWarms.push(task)
    pendingSources.add(task.source)
  }

  drainPreviewWarmQueue()
}

export function clearPreviewPreloadWindow(owner: symbol) {
  preloadWindows.delete(owner)
  removeUndesiredPendingWarms()
}

function previewWarmTask(
  file: PreviewPreloadAsset,
  collectionId?: string,
): PreviewWarmTask {
  return {
    source: apiURL(
      `/files/${encodeURIComponent(file.id)}/content`,
      collectionId ? { collectionId } : undefined,
    ),
    kind: filePreviewKind(file.mimeType, file.category),
  }
}

function removeUndesiredPendingWarms() {
  const desired = desiredPreviewSources()
  pendingPreviewWarms = pendingPreviewWarms.filter((task) => desired.has(task.source))
}

function desiredPreviewSources() {
  const desired = new Set<string>()

  for (const window of preloadWindows.values()) {
    for (const source of window) desired.add(source)
  }

  return desired
}

function drainPreviewWarmQueue() {
  while (
    activePreviewWarms.size < maxConcurrentPreviewWarms &&
    pendingPreviewWarms.length > 0
  ) {
    const task = pendingPreviewWarms.shift()
    if (!task) return

    if (
      warmedPreviewAssets.has(task.source) ||
      activePreviewWarms.has(task.source)
    ) {
      continue
    }

    const warm = preloadPreviewAsset(task)
      .then(() => rememberWarmedPreviewAsset(task.source))
      .catch(() => { })
      .finally(() => {
        activePreviewWarms.delete(task.source)
        drainPreviewWarmQueue()
      })

    activePreviewWarms.set(task.source, warm)
  }
}

async function preloadPreviewAsset(task: PreviewWarmTask) {
  switch (task.kind) {
    case "image":
      await preloadImage(task.source)
      return
    case "video":
    case "audio":
      await preloadMedia(task.source, task.kind)
      return
    case "pdf":
    case "text":
      await preloadRange(task.source)
      return
  }
}

function preloadImage(source: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new window.Image()

    const finish = (error?: Error) => {
      image.onload = null
      image.onerror = null
      if (error) reject(error)
      else resolve()
    }

    image.decoding = "async"
    image.onload = () => finish()
    image.onerror = () => finish(new Error("Preview image preload failed"))
    image.src = source
  })
}

async function preloadMedia(source: string, kind: "video" | "audio") {
  const media = document.createElement(kind)
  media.preload = "metadata"

  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        media.removeEventListener("loadedmetadata", loaded)
        media.removeEventListener("error", failed)
      }

      const loaded = () => {
        cleanup()
        resolve()
      }

      const failed = () => {
        cleanup()
        reject(new Error("Preview media preload failed"))
      }

      media.addEventListener("loadedmetadata", loaded, { once: true })
      media.addEventListener("error", failed, { once: true })
      media.src = source
      media.load()
    })
  } finally {
    media.removeAttribute("src")
    media.load()
  }
}

async function preloadRange(source: string) {
  const response = await fetch(source, {
    credentials: "include",
    headers: {
      Range: `bytes=0-${previewWarmRangeEnd}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Preview range preload failed with ${response.status}`)
  }

  await response.arrayBuffer()
}

function rememberWarmedPreviewAsset(source: string) {
  warmedPreviewAssets.delete(source)
  warmedPreviewAssets.add(source)

  while (warmedPreviewAssets.size > maxRememberedWarmAssets) {
    const oldest = warmedPreviewAssets.values().next().value
    if (!oldest) break
    warmedPreviewAssets.delete(oldest)
  }
}