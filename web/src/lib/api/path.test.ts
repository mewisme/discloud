import { describe, expect, it } from "vitest"

import { apiBackendPath, apiBackendSegments, apiProxyPath, apiURL } from "@/lib/api/path"

describe("apiURL", () => {
  it("builds proxy URLs from versioned API paths", () => {
    expect(apiURL("/api/v1/folders/123")).toBe("/api/backend/folders/123")
    expect(apiURL("api/v1/folders/123")).toBe("/api/backend/folders/123")
  })

  it("builds proxy URLs from short API paths", () => {
    expect(apiURL("/folders/123")).toBe("/api/backend/folders/123")
    expect(apiURL("folders/123")).toBe("/api/backend/folders/123")
  })

  it("encodes query values and ignores nullish values", () => {
    expect(apiURL("/api/v1/search", {
      q: "hello world",
      limit: 25,
      favorite: true,
      cursor: undefined,
      category: null,
    })).toBe("/api/backend/search?q=hello+world&limit=25&favorite=true")
  })

  it("repeats array query parameters", () => {
    expect(apiURL("/api/v1/files", {
      id: ["first", "second"],
    })).toBe("/api/backend/files?id=first&id=second")
  })
})

describe("apiProxyPath", () => {
  it("removes the API version prefix", () => {
    expect(apiProxyPath("/api/v1/folders/123")).toBe("/folders/123")
    expect(apiProxyPath("api/v1/folders/123")).toBe("/folders/123")
  })

  it("keeps short API paths unchanged", () => {
    expect(apiProxyPath("/folders/123")).toBe("/folders/123")
    expect(apiProxyPath("folders/123")).toBe("/folders/123")
  })
})

describe("apiBackendPath", () => {
  it("adds the API version prefix when missing", () => {
    expect(apiBackendPath("/folders/123")).toBe("/api/v1/folders/123")
    expect(apiBackendPath("folders/123")).toBe("/api/v1/folders/123")
  })

  it("does not duplicate an existing API version prefix", () => {
    expect(apiBackendPath("/api/v1/folders/123")).toBe("/api/v1/folders/123")
    expect(apiBackendPath("api/v1/folders/123")).toBe("/api/v1/folders/123")
  })
})

describe("apiBackendSegments", () => {
  it("adds API version segments when missing", () => {
    expect(apiBackendSegments(["folders", "123"])).toEqual(["api", "v1", "folders", "123"])
  })

  it("does not duplicate existing API version segments", () => {
    expect(apiBackendSegments(["api", "v1", "folders", "123"])).toEqual(["api", "v1", "folders", "123"])
  })
})