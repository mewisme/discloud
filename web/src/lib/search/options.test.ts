import { describe, expect, it } from "vitest"

import { parseSearchOptions, patchSearchOptions, searchURL } from "@/lib/search/options"

describe("parseSearchOptions", () => {
  it("uses recent items defaults without a query", () => {
    expect(parseSearchOptions(new URLSearchParams())).toMatchObject({
      q: "",
      kind: "all",
      category: "all",
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
    expect(parseSearchOptions(new URLSearchParams("sort=relevance"))).toMatchObject({
      sort: "updated",
    })
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
  it("omits defaults", () => {
    expect(searchURL(parseSearchOptions(new URLSearchParams("q=report")))).toBe("/search?q=report")
  })

  it("preserves active filters", () => {
    const options = parseSearchOptions(new URLSearchParams("q=report&kind=file&category=document&favorite=true"))
    expect(searchURL(options)).toBe("/search?q=report&kind=file&category=document&favorite=true")
  })
})