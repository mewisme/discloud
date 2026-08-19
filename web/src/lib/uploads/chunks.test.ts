import { describe, expect, it } from "vitest"
import { planUploadParts } from "@/lib/uploads/chunks"

describe("planUploadParts", () => {
  it("handles an empty file", () => {
    expect(planUploadParts(0, 10)).toEqual([])
  })

  it("splits exact chunks", () => {
    expect(planUploadParts(20, 10)).toEqual([
      { index: 0, start: 0, end: 10, size: 10 },
      { index: 1, start: 10, end: 20, size: 10 },
    ])
  })

  it("keeps the final partial chunk", () => {
    expect(planUploadParts(25, 10)).toEqual([
      { index: 0, start: 0, end: 10, size: 10 },
      { index: 1, start: 10, end: 20, size: 10 },
      { index: 2, start: 20, end: 25, size: 5 },
    ])
  })

  it("rejects invalid values", () => {
    expect(() => planUploadParts(-1, 10)).toThrow()
    expect(() => planUploadParts(10, 0)).toThrow()
  })
})