import { describe, expect, it } from "vitest"

import { ThumbnailLoadQueue } from "@/lib/files/thumbnail-queue"

describe("ThumbnailLoadQueue", () => {
  it("limits concurrent loads", async () => {
    const queue = new ThumbnailLoadQueue(2)
    const first = await queue.acquire()
    const second = await queue.acquire()
    let thirdStarted = false

    const thirdPromise = queue.acquire().then((release) => {
      thirdStarted = true
      return release
    })

    await nextTick()
    expect(thirdStarted).toBe(false)

    first()

    const third = await thirdPromise
    expect(thirdStarted).toBe(true)

    second()
    third()
  })

  it("starts the next item when a slot is released", async () => {
    const queue = new ThumbnailLoadQueue(1)
    const first = await queue.acquire()
    let secondStarted = false

    const secondPromise = queue.acquire().then((release) => {
      secondStarted = true
      return release
    })

    await nextTick()
    expect(secondStarted).toBe(false)

    first()

    const second = await secondPromise
    expect(secondStarted).toBe(true)
    second()
  })

  it("removes an aborted pending item without blocking the queue", async () => {
    const queue = new ThumbnailLoadQueue(1)
    const first = await queue.acquire()
    const controller = new AbortController()

    const aborted = queue.acquire(controller.signal)
    let thirdStarted = false
    const thirdPromise = queue.acquire().then((release) => {
      thirdStarted = true
      return release
    })

    controller.abort()

    await expect(aborted).rejects.toMatchObject({ name: "AbortError" })
    expect(thirdStarted).toBe(false)

    first()

    const third = await thirdPromise
    expect(thirdStarted).toBe(true)
    third()
  })

  it("allows release to be called more than once", async () => {
    const queue = new ThumbnailLoadQueue(1)
    const first = await queue.acquire()
    let secondStarted = false

    const secondPromise = queue.acquire().then((release) => {
      secondStarted = true
      return release
    })

    first()
    first()

    const second = await secondPromise
    expect(secondStarted).toBe(true)
    second()
  })

  it("rejects invalid concurrency limits", () => {
    expect(() => new ThumbnailLoadQueue(0)).toThrow()
    expect(() => new ThumbnailLoadQueue(-1)).toThrow()
    expect(() => new ThumbnailLoadQueue(1.5)).toThrow()
  })
})

function nextTick() {
  return new Promise<void>((resolve) => queueMicrotask(resolve))
}