import { describe, expect, it } from "vitest"

import { endOfDayISO, startOfDayISO } from "@/lib/timezone"

describe("timezone day boundaries", () => {
  it("builds UTC day boundaries", () => {
    const date = selectedDate(2026, 8, 20)

    expect(startOfDayISO(date, "UTC")).toBe("2026-08-20T00:00:00.000Z")
    expect(endOfDayISO(date, "UTC")).toBe("2026-08-20T23:59:59.999Z")
  })

  it("builds Asia/Bangkok day boundaries", () => {
    const date = selectedDate(2026, 8, 20)

    expect(startOfDayISO(date, "Asia/Bangkok")).toBe("2026-08-19T17:00:00.000Z")
    expect(endOfDayISO(date, "Asia/Bangkok")).toBe("2026-08-20T16:59:59.999Z")
  })

  it("handles a 23-hour DST day", () => {
    const date = selectedDate(2026, 3, 8)

    expect(startOfDayISO(date, "America/New_York")).toBe("2026-03-08T05:00:00.000Z")
    expect(endOfDayISO(date, "America/New_York")).toBe("2026-03-09T03:59:59.999Z")
  })

  it("handles a 25-hour DST day", () => {
    const date = selectedDate(2026, 11, 1)

    expect(startOfDayISO(date, "America/New_York")).toBe("2026-11-01T04:00:00.000Z")
    expect(endOfDayISO(date, "America/New_York")).toBe("2026-11-02T04:59:59.999Z")
  })
})

function selectedDate(year: number, month: number, day: number) {
  return new Date(year, month - 1, day, 12)
}