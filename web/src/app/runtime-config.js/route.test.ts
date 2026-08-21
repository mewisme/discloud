import { afterEach, describe, expect, it } from "vitest"

import { GET } from "./route"

const publicAPIURL = process.env.DISCLOUD_PUBLIC_API_URL

afterEach(() => {
  if (publicAPIURL === undefined) {
    delete process.env.DISCLOUD_PUBLIC_API_URL
    return
  }

  process.env.DISCLOUD_PUBLIC_API_URL = publicAPIURL
})

describe("runtime config", () => {
  it("exposes the runtime public API URL", async () => {
    process.env.DISCLOUD_PUBLIC_API_URL = "https://api.example.com"

    const response = GET()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/javascript; charset=utf-8")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.text()).toBe(
      'globalThis.__DISCLOUD_CONFIG__={"apiURL":"https://api.example.com"};',
    )
  })

  it("uses an empty API URL when direct access is disabled", async () => {
    delete process.env.DISCLOUD_PUBLIC_API_URL

    expect(await GET().text()).toBe(
      'globalThis.__DISCLOUD_CONFIG__={"apiURL":""};',
    )
  })
})