import { describe, expect, it } from "vitest"

import { ConcurrencyGate } from "@/lib/uploads/gate"

describe("ConcurrencyGate", () => {
  it("rejects non-positive concurrency", () => {
    expect(() => new ConcurrencyGate(0)).toThrow(RangeError)
    expect(() => new ConcurrencyGate(-1)).toThrow(RangeError)
  })

  it("limits concurrent work and releases waiters in order", async () => {
    const gate = new ConcurrencyGate(2)
    const releases = [deferred(), deferred(), deferred()]
    const started: number[] = []
    let active = 0
    let peak = 0

    const tasks = releases.map((release, index) => gate.run(async () => {
      started.push(index)
      active++
      peak = Math.max(peak, active)

      try {
        await release.promise
      } finally {
        active--
      }
    }))

    await flushMicrotasks()

    expect(started).toEqual([0, 1])
    expect(active).toBe(2)
    expect(peak).toBe(2)

    releases[0].resolve()
    await flushMicrotasks()

    expect(started).toEqual([0, 1, 2])
    expect(active).toBe(2)
    expect(peak).toBe(2)

    releases[1].resolve()
    releases[2].resolve()

    await Promise.all(tasks)

    expect(active).toBe(0)
    expect(peak).toBe(2)
  })

  it("releases a slot when work rejects", async () => {
    const gate = new ConcurrencyGate(1)

    await expect(gate.run(async () => {
      throw new Error("boom")
    })).rejects.toThrow("boom")

    await expect(gate.run(async () => "next")).resolves.toBe("next")
  })
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })

  return { promise, resolve }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}