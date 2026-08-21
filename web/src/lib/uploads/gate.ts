type GateWaiter = {
  resolve: () => void
  reject: (reason?: unknown) => void
  signal?: AbortSignal
  abort?: () => void
}

export class ConcurrencyGate {
  private active = 0
  private readonly waiting: GateWaiter[] = []

  constructor(private limit: number) {
    validateLimit(limit)
  }

  setLimit(limit: number) {
    validateLimit(limit)
    this.limit = limit
    this.drain()
  }

  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal)

    try {
      if (signal?.aborted) throw abortReason(signal)
      return await work()
    } finally {
      this.release()
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal))

    if (this.active < this.limit) {
      this.active++
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: GateWaiter = { resolve, reject, signal }

      const abort = () => {
        const index = this.waiting.indexOf(waiter)
        if (index < 0) return

        this.waiting.splice(index, 1)
        signal?.removeEventListener("abort", abort)
        reject(signal ? abortReason(signal) : new DOMException("Operation cancelled", "AbortError"))
      }

      waiter.abort = abort
      this.waiting.push(waiter)
      signal?.addEventListener("abort", abort, { once: true })

      if (signal?.aborted) abort()
    })
  }

  private release() {
    this.active--
    this.drain()
  }

  private drain() {
    while (this.active < this.limit && this.waiting.length > 0) {
      const waiter = this.waiting.shift()!

      if (waiter.abort) waiter.signal?.removeEventListener("abort", waiter.abort)

      if (waiter.signal?.aborted) {
        waiter.reject(abortReason(waiter.signal))
        continue
      }

      this.active++
      waiter.resolve()
    }
  }
}

function validateLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("concurrency must be a positive integer")
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Operation cancelled", "AbortError")
}