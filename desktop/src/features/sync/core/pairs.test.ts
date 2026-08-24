import { describe, expect, it } from "vitest"

import { normalizeSyncPair, patchScopedSyncPair, syncPairForRemotePath } from "./pairs"
import type { SyncPair } from "./types"

const pair: SyncPair = {
  id: "pair",
  serverUrl: "http://localhost",
  username: "mew",
  localPath: "E:\\DisCloud",
  remoteFolderId: "remote",
  remoteFolderName: "Media",
  enabled: true,
  direction: "two-way",
  deletePolicy: "preserve",
  intervalSeconds: 30,
  ignorePatterns: [],
  createdAt: 1,
}

describe("sync pair deletion policy", () => {
  it("migrates legacy two-way preserve pairs to propagate", () => {
    expect(normalizeSyncPair(pair).deletePolicy).toBe("propagate")
  })

  it("keeps preserve for one-way sync", () => {
    expect(normalizeSyncPair({ ...pair, direction: "upload-only" }).deletePolicy).toBe("preserve")
  })

  it("forces propagate when a pair switches to two-way", () => {
    const current = { ...pair, direction: "upload-only" as const, deletePolicy: "preserve" as const }
    expect(patchScopedSyncPair([current], "pair", { direction: "two-way" }, current.serverUrl, current.username)?.[0].deletePolicy).toBe("propagate")
  })
})

describe("sync pair remote path", () => {
  it("matches a sync pair from the current folder ancestry", () => {
    expect(syncPairForRemotePath([pair], ["workspace-root", "remote", "child"])?.id).toBe("pair")
  })

  it("prefers the nearest sync root when paths overlap", () => {
    const nested = { ...pair, id: "nested", remoteFolderId: "child" }
    expect(syncPairForRemotePath([pair, nested], ["workspace-root", "remote", "child", "grandchild"])?.id).toBe("nested")
  })

  it("does not match folders outside sync scope", () => {
    expect(syncPairForRemotePath([pair], ["workspace-root", "other"])).toBeUndefined()
  })
})