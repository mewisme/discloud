import { describe, expect, it } from "vitest"

import { GET } from "./route"

describe("web health endpoint", () => {
  it("returns no content when the web runtime is alive", () => {
    expect(GET().status).toBe(204)
  })
})
