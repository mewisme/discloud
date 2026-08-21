import { describe, expect, it } from "vitest"

import { ConcurrencyGate } from "@/lib/uploads/gate"

describe("ConcurrencyGate", () => {
  it("rejects invalid concurrency", () => {
    expect(() => new ConcurrencyGate(0)).toThrow(RangeError)
    expect(() => new ConcurrencyGate(-1)).toThrow(RangeError)
    expect(() => new ConcurrencyGate(1.5)).toThrow(RangeError)
  })

  it("rejects invalid resized concurrency", () => {
    const gate = new ConcurrencyGate(1)

    expect(() => gate.setLimit(0)).toThrow(RangeError)
    expect(() => gate.setLimit(1.5)).toThrow(RangeError)
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

  it("starts additional waiters when the limit increases", async () => {
    const gate = new ConcurrencyGate(1)
    const releases = [deferred(), deferred(), deferred()]
    const started: number[] = []

    const tasks = releases.map((release, index) => gate.run(async () => {
      started.push(index)
      await release.promise
    }))

    await flushMicrotasks()
    expect(started).toEqual([0])

    gate.setLimit(3)
    await flushMicrotasks()

    expect(started).toEqual([0, 1, 2])

    releases.forEach((release) => release.resolve())
    await Promise.all(tasks)
  })

  it("does not cancel active work when the limit decreases", async () => {
    const gate = new ConcurrencyGate(3)
    const releases = [deferred(), deferred(), deferred(), deferred()]
    const started: number[] = []

    const first = releases.slice(0, 3).map((release, index) => gate.run(async () => {
      started.push(index)
      await release.promise
    }))

    await flushMicrotasks()
    expect(started).toEqual([0, 1, 2])

    gate.setLimit(1)

    const fourth = gate.run(async () => {
      started.push(3)
      await releases[3].promise
    })

    await flushMicrotasks()
    expect(started).toEqual([0, 1, 2])

    releases[0].resolve()
    await flushMicrotasks()
    expect(started).toEqual([0, 1, 2])

    releases[1].resolve()
    await flushMicrotasks()
    expect(started).toEqual([0, 1, 2])

    releases[2].resolve()
    await flushMicrotasks()
    expect(started).toEqual([0, 1, 2, 3])

    releases[3].resolve()
    await Promise.all([...first, fourth])
  })

  it("removes an aborted waiter without consuming a slot", async () => {
    const gate = new ConcurrencyGate(1)
    const firstRelease = deferred()
    const controller = new AbortController()
    let secondStarted = false

    const first = gate.run(() => firstRelease.promise)
    const second = gate.run(async () => {
      secondStarted = true
    }, controller.signal)

    await flushMicrotasks()
    expect(secondStarted).toBe(false)

    controller.abort()

    await expect(second).rejects.toMatchObject({ name: "AbortError" })

    firstRelease.resolve()
    await first

    await expect(gate.run(async () => "next")).resolves.toBe("next")
    expect(secondStarted).toBe(false)
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