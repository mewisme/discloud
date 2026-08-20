export class ThumbnailLoadQueue {
  private active = 0
  private readonly pending: Array<() => void> = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Thumbnail queue limit must be a positive integer")
    }
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal))
        return
      }

      let started = false

      const start = () => {
        if (signal?.aborted) {
          reject(abortReason(signal))
          this.drain()
          return
        }

        started = true
        signal?.removeEventListener("abort", onAbort)
        this.active++

        let released = false
        resolve(() => {
          if (released) return

          released = true
          this.active = Math.max(0, this.active - 1)
          this.drain()
        })
      }

      const onAbort = () => {
        if (started) return

        const index = this.pending.indexOf(start)
        if (index >= 0) this.pending.splice(index, 1)

        reject(abortReason(signal!))
        this.drain()
      }

      signal?.addEventListener("abort", onAbort, { once: true })
      this.pending.push(start)
      this.drain()
    })
  }

  private drain() {
    while (this.active < this.limit && this.pending.length > 0) {
      this.pending.shift()?.()
    }
  }
}

export function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Thumbnail load aborted", "AbortError")
}