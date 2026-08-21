import "client-only"

import { apiURL } from "@/lib/api/client"
import { filePreviewKind } from "@/lib/files/preview"

const maxConcurrentPreviewWarms = 3
const maxRememberedWarmAssets = 256
const previewWarmRangeEnd = 256 * 1024 - 1
const previewWarmTimeoutMs = 8000

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
      .then(() => {
        rememberWarmedPreviewAsset(task.source)
      })
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
      await preloadMedia(task.source, "video")
      return

    case "audio":
      await preloadMedia(task.source, "audio")
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

    let settled = false

    const timeout = window.setTimeout(() => {
      finish(
        new Error("Preview image preload timed out"),
      )
    }, previewWarmTimeoutMs)

    function finish(error?: Error) {
      if (settled) {
        return
      }

      settled = true

      window.clearTimeout(timeout)

      image.onload = null
      image.onerror = null

      if (error) {
        reject(error)
        return
      }

      resolve()
    }

    image.decoding = "async"

    image.onload = () => {
      finish()
    }

    image.onerror = () => {
      finish(
        new Error("Preview image preload failed"),
      )
    }

    image.src = source
  })
}

async function preloadMedia(
  source: string,
  kind: "video" | "audio",
) {
  const media = document.createElement(kind)

  const readyEvent =
    kind === "video"
      ? "loadeddata"
      : "loadedmetadata"

  media.preload =
    kind === "video"
      ? "auto"
      : "metadata"

  if (media instanceof HTMLVideoElement) {
    media.muted = true
    media.playsInline = true
  }

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false

      const timeout = window.setTimeout(() => {
        finish(
          new Error("Preview media preload timed out"),
        )
      }, previewWarmTimeoutMs)

      function cleanup() {
        window.clearTimeout(timeout)

        media.removeEventListener(
          readyEvent,
          loaded,
        )

        media.removeEventListener(
          "error",
          failed,
        )
      }

      function finish(error?: Error) {
        if (settled) {
          return
        }

        settled = true
        cleanup()

        if (error) {
          reject(error)
          return
        }

        resolve()
      }

      function loaded() {
        finish()
      }

      function failed() {
        finish(
          new Error("Preview media preload failed"),
        )
      }

      media.addEventListener(
        readyEvent,
        loaded,
        { once: true },
      )

      media.addEventListener(
        "error",
        failed,
        { once: true },
      )

      media.src = source
      media.load()
    })
  } finally {
    releaseMedia(media)
  }
}

async function preloadRange(source: string) {
  const controller = new AbortController()

  const timeout = window.setTimeout(() => {
    controller.abort()
  }, previewWarmTimeoutMs)

  try {
    const response = await fetch(source, {
      credentials: "include",
      signal: controller.signal,
      headers: {
        Range: `bytes=0-${previewWarmRangeEnd}`,
      },
    })

    if (!response.ok) {
      throw new Error(
        `Preview range preload failed with ${response.status}`,
      )
    }

    await response.arrayBuffer()
  } finally {
    window.clearTimeout(timeout)
  }
}

function releaseMedia(media: HTMLMediaElement) {
  media.pause()
  media.removeAttribute("src")
  media.load()
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