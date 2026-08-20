import { describe, expect, it } from "vitest"

import { APIError } from "@/lib/api/types"
import { apiErrorMessage, apiFormError, formatBytes, formatDuration, handleClientNavigation, initials, isActivePath } from "@/lib/helpers"

describe("helpers", () => {
  it("formats binary byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(1536)).toBe("1.5 KiB")
    expect(formatBytes(1024 ** 3)).toBe("1 GiB")
  })

  it("formats durations", () => {
    expect(formatDuration(65_000)).toBe("1:05")
    expect(formatDuration(3_661_000)).toBe("1:01:01")
  })

  it("builds initials", () => {
    expect(initials("alice")).toBe("AL")
    expect(initials(" ")).toBe("DC")
    expect(initials(" ", "NA")).toBe("NA")
  })

  it("matches active paths", () => {
    expect(isActivePath("/files", "/files")).toBe(true)
    expect(isActivePath("/files/abc", "/files")).toBe(true)
    expect(isActivePath("/search", "/files")).toBe(false)
  })

  it("only intercepts plain left clicks", () => {
    let navigated = false
    let prevented = false
    const event = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: () => { prevented = true } }

    expect(handleClientNavigation(event, () => { navigated = true })).toBe(true)
    expect(prevented).toBe(true)
    expect(navigated).toBe(true)

    expect(handleClientNavigation({ ...event, ctrlKey: true }, () => { throw new Error("should not navigate") })).toBe(false)
  })

  it("extracts API error messages", () => {
    const error = new APIError(400, "Bad Request", {
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail: "Invalid input",
      request_id: "req-1",
    })

    expect(apiErrorMessage(error, "Fallback")).toBe("Invalid input")
    expect(apiErrorMessage(new Error("boom"), "Fallback")).toBe("Fallback")
    expect(apiFormError(error, "Fallback")).toEqual({ message: "Invalid input", requestID: "req-1" })
  })
})