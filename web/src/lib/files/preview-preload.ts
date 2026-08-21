import "client-only"

import { apiURL } from "@/lib/api/client"
import { filePreviewKind } from "@/lib/files/preview"

const maxConcurrentPreviewWarms = 3
const maxRememberedWarmAssets = 256
const previewWarmTimeoutMs = 8000

const defaultPreviewWarmBytes = 256 * 1024
const videoPreviewWarmBytes = 2 * 1024 * 1024

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

  preloadWindows.set(
    owner,
    new Set(tasks.map((task) => task.source)),
  )

  removeUndesiredPendingWarms()

  const pendingSources = new Set(
    pendingPreviewWarms.map((task) => task.source),
  )

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

  pendingPreviewWarms = pendingPreviewWarms.filter(
    (task) => desired.has(task.source),
  )
}

function desiredPreviewSources() {
  const desired = new Set<string>()

  for (const window of preloadWindows.values()) {
    for (const source of window) {
      desired.add(source)
    }
  }

  return desired
}

function drainPreviewWarmQueue() {
  while (
    activePreviewWarms.size < maxConcurrentPreviewWarms &&
    pendingPreviewWarms.length > 0
  ) {
    const task = pendingPreviewWarms.shift()

    if (!task) {
      return
    }

    if (
      warmedPreviewAssets.has(task.source) ||
      activePreviewWarms.has(task.source)
    ) {
      continue
    }

    const warm = preloadPreviewAsset(task)
      .then((success) => {
        if (success) {
          rememberWarmedPreviewAsset(task.source)
        }
      })
      .finally(() => {
        activePreviewWarms.delete(task.source)
        drainPreviewWarmQueue()
      })

    activePreviewWarms.set(task.source, warm)
  }
}

async function preloadPreviewAsset(
  task: PreviewWarmTask,
): Promise<boolean> {
  switch (task.kind) {
    case "image":
      return preloadImage(task.source)

    case "video":
      return preloadRange(
        task.source,
        videoPreviewWarmBytes,
      )

    case "audio":
    case "pdf":
    case "text":
      return preloadRange(
        task.source,
        defaultPreviewWarmBytes,
      )

    default:
      return false
  }
}

function preloadImage(source: string) {
  return new Promise<boolean>((resolve) => {
    const image = new window.Image()
    let settled = false

    const timeout = window.setTimeout(() => {
      finish(false)
    }, previewWarmTimeoutMs)

    function finish(success: boolean) {
      if (settled) {
        return
      }

      settled = true

      window.clearTimeout(timeout)

      image.onload = null
      image.onerror = null

      resolve(success)
    }

    image.decoding = "async"

    image.onload = () => {
      finish(true)
    }

    image.onerror = () => {
      finish(false)
    }

    image.src = source
  })
}

async function preloadRange(
  source: string,
  bytes: number,
): Promise<boolean> {
  const controller = new AbortController()
  let timedOut = false

  const timeout = window.setTimeout(() => {
    timedOut = true

    controller.abort(
      new Error("Preview preload timed out"),
    )
  }, previewWarmTimeoutMs)

  try {
    const response = await fetch(source, {
      credentials: "include",
      signal: controller.signal,
      headers: {
        Range: `bytes=0-${Math.max(0, bytes - 1)}`,
      },
    })

    if (!response.ok) {
      return false
    }

    await response.arrayBuffer()

    return true
  } catch {
    return false
  } finally {
    window.clearTimeout(timeout)

    if (timedOut && !controller.signal.aborted) {
      controller.abort()
    }
  }
}

function rememberWarmedPreviewAsset(source: string) {
  warmedPreviewAssets.delete(source)
  warmedPreviewAssets.add(source)

  while (
    warmedPreviewAssets.size >
    maxRememberedWarmAssets
  ) {
    const oldest =
      warmedPreviewAssets.values().next().value

    if (!oldest) {
      break
    }

    warmedPreviewAssets.delete(oldest)
  }
}