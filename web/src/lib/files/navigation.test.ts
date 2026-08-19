import { describe, expect, it } from "vitest"
import { folderBrowserPath, folderBrowserURL, folderIdFromBrowserPath } from "@/lib/files/navigation"

describe("file browser navigation", () => {
  it("parses the Files root", () => {
    expect(folderIdFromBrowserPath("/files")).toBeUndefined()
    expect(folderIdFromBrowserPath("/files/")).toBeUndefined()
  })

  it("parses a folder route", () => {
    expect(folderIdFromBrowserPath("/files/folder-123")).toBe("folder-123")
    expect(folderIdFromBrowserPath("/files/a%20b")).toBe("a b")
  })

  it("ignores nested non-folder routes", () => {
    expect(folderIdFromBrowserPath("/files/file/123")).toBeNull()
    expect(folderIdFromBrowserPath("/search")).toBeNull()
  })

  it("builds browser URLs", () => {
    expect(folderBrowserPath("a b")).toBe("/files/a%20b")
    expect(folderBrowserURL("abc", { view: "grid", sort: "updated", order: "desc" })).toBe("/files/abc?view=grid&sort=updated&order=desc")
  })
})