import type { SyncPair } from "./types"

export type UpdateSyncPairInput = Partial<Pick<SyncPair, "remoteFolderName" | "enabled" | "direction" | "deletePolicy" | "intervalSeconds" | "ignorePatterns">>

export function scopedSyncPairs(pairs: readonly SyncPair[], serverUrl?: string, username?: string): SyncPair[] {
  if (!serverUrl || !username) return []
  return pairs.filter((pair) => pair.serverUrl === serverUrl && pair.username === username)
}

export function patchScopedSyncPair(pairs: readonly SyncPair[], pairId: string, patch: UpdateSyncPairInput, serverUrl: string, username: string): SyncPair[] | undefined {
  const current = pairs.find((pair) => pair.id === pairId)
  if (!current || current.serverUrl !== serverUrl || current.username !== username) return undefined
  return pairs.map((pair) => pair.id === pairId ? { ...pair, ...patch } : pair)
}

export function syncPairsForValidation(pairs: readonly SyncPair[], runningPairIds: ReadonlySet<string>): SyncPair[] {
  return pairs.map((pair) => !pair.enabled && runningPairIds.has(pair.id) ? { ...pair, enabled: true } : pair)
}
