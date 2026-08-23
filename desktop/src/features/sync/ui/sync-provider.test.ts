import { describe, expect, it } from "vitest"

import { patchScopedSyncPair, scopedSyncPairs, syncPairsForValidation } from "../core/pairs"
import type { SyncPair } from "../core/types"

function pair(id: string, overrides: Partial<SyncPair> = {}): SyncPair {
  return {
    id,
    serverUrl: "https://cloud.example.com",
    username: "mew",
    localPath: "/sync/files",
    remoteFolderId: "remote-" + id,
    remoteFolderName: "Folder " + id,
    enabled: true,
    direction: "two-way",
    deletePolicy: "preserve",
    intervalSeconds: 60,
    ignorePatterns: [],
    createdAt: 1,
    ...overrides,
  }
}

describe("sync provider pair projection", () => {
  it("scopes persisted pairs to the connected server and user", () => {
    const pairs = [
      pair("current"),
      pair("other-server", { serverUrl: "https://other.example.com" }),
      pair("other-user", { username: "someone-else" }),
    ]

    expect(scopedSyncPairs(pairs, "https://cloud.example.com", "mew").map((item) => item.id)).toEqual(["current"])
    expect(scopedSyncPairs(pairs)).toEqual([])
  })

  it("persists enable and disable changes only inside the active scope", () => {
    const pairs = [pair("current"), pair("foreign", { username: "someone-else" })]
    const disabled = patchScopedSyncPair(pairs, "current", { enabled: false }, "https://cloud.example.com", "mew")
    expect(disabled?.find((item) => item.id === "current")?.enabled).toBe(false)
    expect(pairs[0].enabled).toBe(true)

    const enabled = patchScopedSyncPair(disabled ?? pairs, "current", { enabled: true }, "https://cloud.example.com", "mew")
    expect(enabled?.find((item) => item.id === "current")?.enabled).toBe(true)
    expect(patchScopedSyncPair(pairs, "foreign", { enabled: false }, "https://cloud.example.com", "mew")).toBeUndefined()
  })

  it("temporarily enables a disabled pair for validation while it is manually running", () => {
    const disabled = pair("manual", { enabled: false })
    const validationPairs = syncPairsForValidation([disabled], new Set([disabled.id]))

    expect(validationPairs[0].enabled).toBe(true)
    expect(disabled.enabled).toBe(false)
    expect(syncPairsForValidation([disabled], new Set())[0].enabled).toBe(false)
  })
})
