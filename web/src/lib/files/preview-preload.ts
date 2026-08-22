import "client-only"

import { apiDirectURL } from "@/lib/api/client"
import { filePreviewKind } from "@discloud/shared/file-preview"

const maxConcurrentPreviewWarms = 3
const maxRememberedWarmTasks = 256
const previewWarmTimeoutMs = 8000
const defaultPreviewWarmBytes = 256 * 1024
const videoPreviewWarmBytes = 2 * 1024 * 1024
const activeVideoChunkPriority = 0
const previewAssetPriority = 1

export type PreviewPreloadAsset = {
  id: string
  size?: number
  mimeType: string
  category?: string
}

type PreviewWarmTask =
  | {
    key: string
    source: string
    kind: "image"
    priority: number
  }
  | {
    key: string
    source: string
    kind: "range"
    start: number
    end: number
    priority: number
  }

const preloadWindows = new Map<symbol, Set<string>>()
const warmedPreviewTasks = new Set<string>()
const activePreviewWarms = new Map<string, Promise<void>>()
let pendingPreviewWarms: PreviewWarmTask[] = []

export function setPreviewPreloadWindow(
  owner: symbol,
  files: readonly PreviewPreloadAsset[],
  collectionId?: string,
) {
  const tasks = files.flatMap((file) => {
    const task = previewWarmTask(file, collectionId)
    return task ? [task] : []
  })

  setWarmWindow(owner, tasks)
}

export function setVideoChunkPreloadWindow(
  owner: symbol,
  source: string,
  fileSize: number,
  chunkSize: number,
  currentChunk: number,
  preloadNext: number,
) {
  if (
    fileSize <= 0 ||
    chunkSize <= 0 ||
    currentChunk < 0 ||
    !Number.isFinite(fileSize) ||
    !Number.isFinite(chunkSize)
  ) {
    clearPreviewPreloadWindow(owner)
    return
  }

  const totalChunks = Math.ceil(fileSize / chunkSize)
  const safeCurrentChunk = Math.min(
    totalChunks - 1,
    Math.floor(currentChunk),
  )
  const preloadAhead = Math.max(
    0,
    Math.floor(preloadNext),
  ) + 1
  const firstChunk = safeCurrentChunk + 1
  const lastChunk = Math.min(
    totalChunks - 1,
    safeCurrentChunk + preloadAhead,
  )
  const tasks: PreviewWarmTask[] = []

  for (
    let chunkIndex = firstChunk;
    chunkIndex <= lastChunk;
    chunkIndex++
  ) {
    const start = chunkIndex * chunkSize
    const end = Math.min(
      fileSize - 1,
      start + chunkSize - 1,
    )

    tasks.push({
      key: `${source}:video-chunk:${chunkIndex}`,
      source,
      kind: "range",
      start,
      end,
      priority: activeVideoChunkPriority,
    })
  }

  setWarmWindow(owner, tasks)
}

export function clearPreviewPreloadWindow(owner: symbol) {
  preloadWindows.delete(owner)
  removeUndesiredPendingWarms()
}

function setWarmWindow(
  owner: symbol,
  tasks: readonly PreviewWarmTask[],
) {
  preloadWindows.set(
    owner,
    new Set(tasks.map((task) => task.key)),
  )

  removeUndesiredPendingWarms()

  const pendingKeys = new Set(
    pendingPreviewWarms.map((task) => task.key),
  )

  for (const task of tasks) {
    if (
      warmedPreviewTasks.has(task.key) ||
      activePreviewWarms.has(task.key) ||
      pendingKeys.has(task.key)
    ) {
      continue
    }

    pendingPreviewWarms.push(task)
    pendingKeys.add(task.key)
  }

  pendingPreviewWarms.sort(
    (left, right) =>
      left.priority - right.priority,
  )

  drainPreviewWarmQueue()
}

function previewWarmTask(
  file: PreviewPreloadAsset,
  collectionId?: string,
): PreviewWarmTask | null {
  const source = apiDirectURL(
    `/files/${encodeURIComponent(file.id)}/content`,
    collectionId ? { collectionId } : undefined,
  )
  const kind = filePreviewKind(
    file.mimeType,
    file.category,
  )

  switch (kind) {
    case "image":
      return {
        key: `${source}:preview:image`,
        source,
        kind: "image",
        priority: previewAssetPriority,
      }

    case "video":
      return initialRangeTask(
        source,
        file.size,
        videoPreviewWarmBytes,
      )

    case "audio":
    case "pdf":
    case "text":
      return initialRangeTask(
        source,
        file.size,
        defaultPreviewWarmBytes,
      )

    default:
      return null
  }
}

function initialRangeTask(
  source: string,
  fileSize: number | undefined,
  bytes: number,
): PreviewWarmTask | null {
  if (fileSize === 0) return null

  const end = fileSize != null && fileSize > 0
    ? Math.min(fileSize, bytes) - 1
    : bytes - 1

  if (end < 0) return null

  return {
    key: `${source}:preview:range:0-${end}`,
    source,
    kind: "range",
    start: 0,
    end,
    priority: previewAssetPriority,
  }
}

function removeUndesiredPendingWarms() {
  const desired = desiredPreviewKeys()

  pendingPreviewWarms = pendingPreviewWarms.filter(
    (task) => desired.has(task.key),
  )
}

function desiredPreviewKeys() {
  const desired = new Set<string>()

  for (const window of preloadWindows.values()) {
    for (const key of window) desired.add(key)
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
      warmedPreviewTasks.has(task.key) ||
      activePreviewWarms.has(task.key)
    ) {
      continue
    }

    const warm = preloadPreviewTask(task)
      .then((success) => {
        if (success) rememberWarmedPreviewTask(task.key)
      })
      .finally(() => {
        activePreviewWarms.delete(task.key)
        drainPreviewWarmQueue()
      })

    activePreviewWarms.set(task.key, warm)
  }
}

async function preloadPreviewTask(
  task: PreviewWarmTask,
): Promise<boolean> {
  switch (task.kind) {
    case "image":
      return preloadImage(task.source)

    case "range":
      return preloadRange(
        task.source,
        task.start,
        task.end,
      )
  }
}

function preloadImage(source: string) {
  return new Promise<boolean>((resolve) => {
    const image = new window.Image()
    let settled = false

    const timeout = window.setTimeout(
      () => finish(false),
      previewWarmTimeoutMs,
    )

    function finish(success: boolean) {
      if (settled) return

      settled = true
      window.clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      resolve(success)
    }

    image.decoding = "async"
    image.onload = () => finish(true)
    image.onerror = () => finish(false)
    image.src = source
  })
}

async function preloadRange(
  source: string,
  start: number,
  end: number,
): Promise<boolean> {
  if (start < 0 || end < start) return false

  const controller = new AbortController()

  const timeout = window.setTimeout(() => {
    controller.abort(
      new Error("Preview preload timed out"),
    )
  }, previewWarmTimeoutMs)

  try {
    const response = await fetch(source, {
      credentials: "include",
      signal: controller.signal,
      headers: {
        Range: `bytes=${start}-${end}`,
      },
    })

    if (!response.ok) return false

    await consumeResponse(response)
    return true
  } catch {
    return false
  } finally {
    window.clearTimeout(timeout)
  }
}

async function consumeResponse(response: Response) {
  if (!response.body) {
    await response.arrayBuffer()
    return
  }

  const reader = response.body.getReader()

  try {
    while (true) {
      const result = await reader.read()
      if (result.done) return
    }
  } finally {
    reader.releaseLock()
  }
}

function rememberWarmedPreviewTask(key: string) {
  warmedPreviewTasks.delete(key)
  warmedPreviewTasks.add(key)

  while (
    warmedPreviewTasks.size >
    maxRememberedWarmTasks
  ) {
    const oldest =
      warmedPreviewTasks.values().next().value

    if (!oldest) break
    warmedPreviewTasks.delete(oldest)
  }
}