import "client-only"

const maxConcurrentThumbnailLoads = 4
const maxThumbnailAttempts = 4
const thumbnailLoadTimeoutMs = 15_000
const pending: Array<() => void> = []
let active = 0

export async function loadThumbnail(baseURL: string, signal?: AbortSignal) {
  let lastError: unknown

  for (let attempt = 0; attempt < maxThumbnailAttempts; attempt++) {
    if (signal?.aborted) throw abortReason(signal)

    if (attempt > 0) {
      await waitForThumbnailRetry(attempt, signal)
    }

    const release = await acquireThumbnailLoadSlot(signal)
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

function acquireThumbnailLoadSlot(signal?: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }

    let started = false

    const start = () => {
      if (signal?.aborted) {
        reject(abortReason(signal))
        drainThumbnailQueue()
        return
      }

      started = true
      signal?.removeEventListener("abort", onAbort)
      active++

      let released = false
      resolve(() => {
        if (released) return
        released = true
        active = Math.max(0, active - 1)
        drainThumbnailQueue()
      })
    }

    const onAbort = () => {
      if (started) return

      const index = pending.indexOf(start)
      if (index >= 0) pending.splice(index, 1)
      reject(abortReason(signal!))
      drainThumbnailQueue()
    }

    signal?.addEventListener("abort", onAbort, { once: true })
    pending.push(start)
    drainThumbnailQueue()
  })
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

    const onAbort = () => {
      image.src = ""
      finish(abortReason(signal!))
    }

    const timeout = window.setTimeout(() => {
      image.src = ""
      finish(new Error("Thumbnail load timed out"))
    }, thumbnailLoadTimeoutMs)

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

function drainThumbnailQueue() {
  while (active < maxConcurrentThumbnailLoads && pending.length > 0) {
    pending.shift()?.()
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Thumbnail load aborted", "AbortError")
}