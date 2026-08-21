type GateWaiter = {
  resolve: () => void
  reject: (reason?: unknown) => void
  signal?: AbortSignal
  abort?: () => void
}

const ADAPTIVE_INITIAL_LIMIT = 2
const LATENCY_EWMA_WEIGHT = 0.2
const LATENCY_GROWTH_RATIO = 1.5
const LATENCY_GROWTH_SLACK_MS = 250
const MIN_DECREASE_COOLDOWN_MS = 500
const MAX_DECREASE_COOLDOWN_MS = 5000

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

export class AdaptiveConcurrencyGate {
  private readonly gate = new ConcurrencyGate(1)
  private ceiling = 1
  private limit = 1
  private initialized = false
  private healthySuccesses = 0
  private latencyEwmaMs = 0
  private lastDecreaseAt = Number.NEGATIVE_INFINITY

  get currentLimit() {
    return this.limit
  }

  get maxLimit() {
    return this.ceiling
  }

  setCeiling(limit: number) {
    validateLimit(limit)
    if (this.ceiling !== limit) this.healthySuccesses = 0
    this.ceiling = limit

    if (!this.initialized) {
      this.initialized = true
      this.setLimit(Math.min(ADAPTIVE_INITIAL_LIMIT, limit))
      return
    }

    if (this.limit > limit) this.setLimit(limit)
  }

  run<T>(work: () => Promise<T>, signal?: AbortSignal) {
    return this.gate.run(work, signal)
  }

  recordSuccess(durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs < 0) return

    const duration = Math.max(1, durationMs)
    const previousLatency = this.latencyEwmaMs
    const latencyHealthy = previousLatency === 0
      || duration <= Math.max(previousLatency * LATENCY_GROWTH_RATIO, previousLatency + LATENCY_GROWTH_SLACK_MS)

    this.latencyEwmaMs = previousLatency === 0
      ? duration
      : previousLatency * (1 - LATENCY_EWMA_WEIGHT) + duration * LATENCY_EWMA_WEIGHT

    if (this.limit >= this.ceiling) return
    if (!latencyHealthy) {
      this.healthySuccesses = 0
      return
    }

    this.healthySuccesses++
    if (this.healthySuccesses < this.limit) return

    this.healthySuccesses = 0
    this.setLimit(this.limit + 1)
  }

  recordCongestion(now = Date.now()) {
    this.healthySuccesses = 0
    if (this.limit <= 1) return

    const cooldown = Math.min(
      MAX_DECREASE_COOLDOWN_MS,
      Math.max(MIN_DECREASE_COOLDOWN_MS, this.latencyEwmaMs || MIN_DECREASE_COOLDOWN_MS),
    )
    if (now - this.lastDecreaseAt < cooldown) return

    this.lastDecreaseAt = now
    this.setLimit(Math.max(1, Math.ceil(this.limit / 2)))
  }

  private setLimit(limit: number) {
    const next = Math.min(this.ceiling, Math.max(1, limit))
    if (next === this.limit) return
    this.limit = next
    this.gate.setLimit(next)
  }
}

function validateLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("concurrency must be a positive integer")
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Operation cancelled", "AbortError")
}