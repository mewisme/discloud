import "client-only"

const maxConcurrentThumbnailLoads = 4
const maxThumbnailAttempts = 4
const pending: Array<() => void> = []
let active = 0

export function acquireThumbnailLoadSlot(signal?: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }

    let started = false

    const start = () => {
      if (signal?.aborted) {
        reject(abortReason(signal))
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

export function thumbnailAttemptURL(baseURL: string, attempt: number) {
  if (attempt <= 0) return baseURL

  const url = new URL(baseURL, window.location.origin)
  url.searchParams.set("_thumbnailRetry", String(attempt))
  return `${url.pathname}${url.search}${url.hash}`
}

export function waitForThumbnailRetry(attempt: number, signal?: AbortSignal) {
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

export function canRetryThumbnail(attempt: number) {
  return attempt + 1 < maxThumbnailAttempts
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