import { describe, expect, it } from "vitest"

import { AdaptiveConcurrencyGate } from "@/lib/uploads/gate"

describe("AdaptiveConcurrencyGate", () => {
  it("starts conservatively and respects the server ceiling", () => {
    const gate = new AdaptiveConcurrencyGate()

    gate.setCeiling(6)
    expect(gate.currentLimit).toBe(2)
    expect(gate.maxLimit).toBe(6)

    gate.setCeiling(1)
    expect(gate.currentLimit).toBe(1)
    expect(gate.maxLimit).toBe(1)
    expect(() => gate.setCeiling(0)).toThrow(RangeError)
  })

  it("grows additively after healthy upload windows", () => {
    const gate = new AdaptiveConcurrencyGate()
    gate.setCeiling(5)

    gate.recordSuccess(100)
    gate.recordSuccess(100)
    expect(gate.currentLimit).toBe(3)

    gate.recordSuccess(100)
    gate.recordSuccess(100)
    gate.recordSuccess(100)
    expect(gate.currentLimit).toBe(4)

    gate.recordSuccess(100)
    gate.recordSuccess(100)
    gate.recordSuccess(100)
    gate.recordSuccess(100)
    expect(gate.currentLimit).toBe(5)
  })

  it("pauses growth when successful parts become much slower", () => {
    const gate = new AdaptiveConcurrencyGate()
    gate.setCeiling(5)

    gate.recordSuccess(100)
    gate.recordSuccess(100)
    expect(gate.currentLimit).toBe(3)

    gate.recordSuccess(1000)
    gate.recordSuccess(100)
    gate.recordSuccess(100)
    expect(gate.currentLimit).toBe(3)

    gate.recordSuccess(100)
    expect(gate.currentLimit).toBe(4)
  })

  it("backs off multiplicatively and coalesces congestion bursts", () => {
    const gate = new AdaptiveConcurrencyGate()
    gate.setCeiling(8)

    gate.recordSuccess(100)
    gate.recordSuccess(100)
    gate.recordSuccess(100)
    gate.recordSuccess(100)
    gate.recordSuccess(100)
    expect(gate.currentLimit).toBe(4)

    gate.recordCongestion(10_000)
    expect(gate.currentLimit).toBe(2)

    gate.recordCongestion(10_001)
    expect(gate.currentLimit).toBe(2)

    gate.recordCongestion(11_000)
    expect(gate.currentLimit).toBe(1)
  })
})