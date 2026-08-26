import { describe, expect, it } from "vitest"

import { normalizeNativePath } from "./native-path"

describe("normalizeNativePath", () => {
  it("preserves normal paths", () => {
    expect(normalizeNativePath("C:\\Users\\Mew\\Sync")).toBe("C:\\Users\\Mew\\Sync")
    expect(normalizeNativePath("/tmp/discloud")).toBe("/tmp/discloud")
  })

  it("removes the Windows verbatim disk prefix", () => {
    expect(normalizeNativePath("\\\\?\\C:\\Users\\Mew\\Sync")).toBe("C:\\Users\\Mew\\Sync")
  })

  it("converts the Windows verbatim UNC prefix", () => {
    expect(normalizeNativePath("\\\\?\\UNC\\server\\share\\folder")).toBe("\\\\server\\share\\folder")
  })

  it("preserves non-filesystem verbatim namespaces", () => {
    expect(normalizeNativePath("\\\\?\\Volume{1234}\\folder")).toBe("\\\\?\\Volume{1234}\\folder")
  })
})
