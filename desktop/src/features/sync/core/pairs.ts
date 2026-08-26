import { normalizeNativePath } from "#lib/native-path"

import type { SyncPair } from "./types"

export type UpdateSyncPairInput = Partial<Pick<SyncPair, "localPath" | "remoteFolderName" | "enabled" | "direction" | "deletePolicy" | "intervalSeconds" | "ignorePatterns">>

export function normalizeSyncPair(pair: SyncPair): SyncPair {
  const localPath = normalizeNativePath(pair.localPath)
  const deletePolicy = pair.direction === "two-way" ? "propagate" : pair.deletePolicy
  return localPath !== pair.localPath || deletePolicy !== pair.deletePolicy ? { ...pair, localPath, deletePolicy } : pair
}

export function scopedSyncPairs(pairs: readonly SyncPair[], serverUrl?: string, username?: string): SyncPair[] {
  if (!serverUrl || !username) return []
  return pairs.filter((pair) => pair.serverUrl === serverUrl && pair.username === username)
}

export function syncPairForRemotePath(pairs: readonly SyncPair[], folderIds: readonly string[]): SyncPair | undefined {
  const byFolderId = new Map(pairs.map((pair) => [pair.remoteFolderId, pair]))
  for (let index = folderIds.length - 1; index >= 0; index--) {
    const pair = byFolderId.get(folderIds[index])
    if (pair) return pair
  }
  return undefined
}

export function patchScopedSyncPair(pairs: readonly SyncPair[], pairId: string, patch: UpdateSyncPairInput, serverUrl: string, username: string): SyncPair[] | undefined {
  const current = pairs.find((pair) => pair.id === pairId)
  if (!current || current.serverUrl !== serverUrl || current.username !== username) return undefined
  return pairs.map((pair) => pair.id === pairId ? normalizeSyncPair({ ...pair, ...patch }) : pair)
}

export function syncPairsForValidation(pairs: readonly SyncPair[], runningPairIds: ReadonlySet<string>): SyncPair[] {
  return pairs.map((pair) => !pair.enabled && runningPairIds.has(pair.id) ? { ...pair, enabled: true } : pair)
}
