import "client-only"

import { abortReason, ThumbnailLoadQueue } from "@/lib/files/thumbnail-queue"

const maxConcurrentThumbnailLoads = 4
const maxThumbnailAttempts = 4
const thumbnailLoadTimeoutMs = 15_000
const thumbnailQueue = new ThumbnailLoadQueue(maxConcurrentThumbnailLoads)

export async function loadThumbnail(baseURL: string, signal?: AbortSignal) {
  let lastError: unknown

  for (let attempt = 0; attempt < maxThumbnailAttempts; attempt++) {
    if (signal?.aborted) throw abortReason(signal)

    if (attempt > 0) {
      await waitForThumbnailRetry(attempt, signal)
    }

    const release = await thumbnailQueue.acquire(signal)
    const source = thumbnailAttemptURL(baseURL, attempt)

    try {
      await preloadThumbnail(source, signal)
      return source
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal)
      lastError = error
    } finally {
      release()
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Thumbnail could not be loaded")
}

function preloadThumbnail(source: string, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }

    const image = new window.Image()
    let settled = false

    const finish = (error?: Error) => {
      if (settled) return

      settled = true
      window.clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
      image.onload = null
      image.onerror = null

      if (error) reject(error)
      else resolve()
    }

    const stop = (error: Error) => {
      finish(error)
      image.src = ""
    }

    const onAbort = () => stop(abortReason(signal!))
    const timeout = window.setTimeout(() => stop(new Error("Thumbnail load timed out")), thumbnailLoadTimeoutMs)

    image.onload = () => finish()
    image.onerror = () => finish(new Error("Thumbnail request failed"))
    signal?.addEventListener("abort", onAbort, { once: true })
    image.src = source
  })
}

function thumbnailAttemptURL(baseURL: string, attempt: number) {
  if (attempt <= 0) return baseURL

  const url = new URL(baseURL, window.location.origin)
  url.searchParams.set("_thumbnailRetry", String(attempt))
  return `${url.pathname}${url.search}${url.hash}`
}

function waitForThumbnailRetry(attempt: number, signal?: AbortSignal) {
  const delay = 500 * 2 ** Math.max(0, attempt - 1)

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }

    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, delay)

    const onAbort = () => {
      window.clearTimeout(timeout)
      reject(abortReason(signal!))
    }

    signal?.addEventListener("abort", onAbort, { once: true })
  })
}