import { describe, expect, it } from "vitest"
import { apiBackendPath, apiBackendSegments, apiProxyPath } from "@/lib/api/path"

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