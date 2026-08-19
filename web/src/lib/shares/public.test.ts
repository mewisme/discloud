import { describe, expect, it } from "vitest"
import { publicFileContentPath, publicFileDownloadPath, publicFolderDownloadPath, publicFolderPath, publicSharePath } from "@/lib/shares/public"

describe("public share paths", () => {
  it("builds root share paths", () => {
    expect(publicSharePath("abc/123")).toBe("/api/v1/public/shares/abc%2F123")
    expect(publicFileContentPath("abc")).toBe("/api/v1/public/shares/abc/content")
    expect(publicFileDownloadPath("abc")).toBe("/api/v1/public/shares/abc/download")
  })

  it("builds nested resource paths", () => {
    expect(publicFileContentPath("abc", "file 1")).toBe("/api/v1/public/shares/abc/files/file%201/content")
    expect(publicFileDownloadPath("abc", "file 1")).toBe("/api/v1/public/shares/abc/files/file%201/download")
    expect(publicFolderPath("abc", "folder 1")).toBe("/api/v1/public/shares/abc/folders/folder%201")
    expect(publicFolderDownloadPath("abc", "folder 1")).toBe("/api/v1/public/shares/abc/folders/folder%201/download")
  })
})