import { parseSearchOptions, patchSearchOptions, searchURL } from "@discloud/shared/search"
import { describe, expect, it } from "vitest"

describe("parseSearchOptions", () => {
  it("uses recent items defaults without a query", () => {
    expect(parseSearchOptions(new URLSearchParams())).toMatchObject({
      q: "",
      kind: "all",
      category: "all",
      favorite: "any",
      shared: "any",
      sort: "updated",
      order: "desc",
    })
  })

  it("uses relevance for a text query", () => {
    expect(parseSearchOptions(new URLSearchParams("q=report"))).toMatchObject({
      q: "report",
      sort: "relevance",
      order: "desc",
    })
  })

  it("normalizes invalid values", () => {
    expect(parseSearchOptions(new URLSearchParams("kind=broken&sort=broken&order=broken"))).toMatchObject({
      kind: "all",
      sort: "updated",
      order: "desc",
    })
  })

  it("does not allow relevance without a query", () => {
    expect(parseSearchOptions(new URLSearchParams("sort=relevance")).sort).toBe("updated")
  })

  it("ignores the legacy ownerId query", () => {
    expect(parseSearchOptions(new URLSearchParams("ownerId=019c7b90-4b3d-7000-8000-000000000001")))
      .not.toHaveProperty("ownerId")
  })
})

describe("patchSearchOptions", () => {
  it("switches the default sort to relevance when typing a query", () => {
    const current = parseSearchOptions(new URLSearchParams())

    expect(patchSearchOptions(current, { q: "photo" })).toMatchObject({
      q: "photo",
      sort: "relevance",
      order: "desc",
    })
  })

  it("preserves an explicitly selected sort", () => {
    const current = parseSearchOptions(new URLSearchParams("sort=name"))
    expect(patchSearchOptions(current, { q: "photo" }).sort).toBe("name")
  })
})

describe("searchURL", () => {
  it("uses the workspace username and omits defaults", () => {
    expect(searchURL("alice", parseSearchOptions(new URLSearchParams("q=report"))))
      .toBe("/alice/search?q=report")
  })

  it("preserves active filters", () => {
    const options = parseSearchOptions(new URLSearchParams("q=report&kind=file&category=document&favorite=true"))

    expect(searchURL("alice", options))
      .toBe("/alice/search?q=report&kind=file&category=document&favorite=true")
  })
})