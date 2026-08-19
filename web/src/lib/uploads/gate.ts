
export class ConcurrencyGate {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {
    if (limit < 1) throw new RangeError("concurrency must be positive")
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire()

    try {
      return await work()
    } finally {
      this.release()
    }
  }

  private async acquire() {
    if (this.active < this.limit) {
      this.active++
      return
    }

    await new Promise<void>((resolve) => this.waiting.push(resolve))
  }

  private release() {
    const next = this.waiting.shift()
    if (next) next()
    else this.active--
  }
}