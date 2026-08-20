import { describe, expect, it } from "vitest"

import { filePreviewKind, isTextMIME } from "@/lib/files/preview"

describe("filePreviewKind", () => {
  it("classifies safe image formats", () => {
    expect(filePreviewKind("image/png")).toBe("image")
    expect(filePreviewKind("image/webp")).toBe("image")
  })

  it("does not inline SVG", () => {
    expect(filePreviewKind("image/svg+xml", "image")).toBe("unsupported")
  })

  it("classifies range-capable media", () => {
    expect(filePreviewKind("video/mp4")).toBe("video")
    expect(filePreviewKind("audio/mpeg")).toBe("audio")
  })

  it("classifies PDF and text", () => {
    expect(filePreviewKind("application/pdf")).toBe("pdf")
    expect(filePreviewKind("text/plain")).toBe("text")
    expect(filePreviewKind("application/json")).toBe("text")
  })
})

describe("isTextMIME", () => {
  it("supports structured text MIME types", () => {
    expect(isTextMIME("application/problem+json")).toBe(true)
    expect(isTextMIME("application/xml")).toBe(true)
    expect(isTextMIME("application/octet-stream")).toBe(false)
  })
})