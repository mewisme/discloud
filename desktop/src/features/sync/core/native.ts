import { invoke } from "@tauri-apps/api/core"

import { nativeError } from "#lib/api/transport"

import type { SyncConflict, SyncConflictResolution, SyncPair, SyncRunResult } from "./types"

export async function pickSyncFolder(remoteFolderId: string) {
  try {
    return await invoke<string | null>("pick_sync_folder", { remoteFolderId }) ?? undefined
  } catch (error) {
    throw nativeError(error)
  }
}

export async function runNativeSyncPair(pair: SyncPair) {
  try {
    return await invoke<SyncRunResult>("run_sync_pair", { pair: nativeSyncPair(pair) })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function listNativeSyncConflicts(pairId: string) {
  try {
    return await invoke<SyncConflict[]>("list_sync_conflicts", { pairId })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function resolveNativeSyncConflict(pair: SyncPair, conflictId: string, resolution: SyncConflictResolution) {
  try {
    return await invoke<SyncRunResult>("resolve_sync_conflict", { pair: nativeSyncPair(pair), conflictId, resolution })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function openNativeSyncPath(pairId: string, localPath: string) {
  try {
    await invoke<void>("open_sync_local_path", { pairId, localPath })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function clearNativeSyncPairState(pairId: string) {
  try {
    await invoke<void>("clear_sync_pair_state", { pairId })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function revokeNativeSyncPairAuthorization(pairId: string) {
  try {
    await invoke<void>("revoke_sync_pair_authorization", { pairId })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function validateNativeSyncPairs(pairs: readonly SyncPair[]) {
  try {
    await invoke<void>("validate_sync_pairs", { pairs: pairs.map(nativeSyncValidationPair) })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function configureNativeSyncPairs(pairs: readonly SyncPair[]) {
  try {
    await invoke<void>("configure_sync_pairs", { pairs: pairs.map(nativeSyncPair) })
  } catch (error) {
    throw nativeError(error)
  }
}

function nativeSyncValidationPair(pair: SyncPair) {
  return {
    id: pair.id,
    localPath: pair.localPath,
    remoteFolderId: pair.remoteFolderId,
    direction: pair.direction,
    enabled: pair.enabled,
  }
}

function nativeSyncPair(pair: SyncPair) {
  return {
    ...nativeSyncValidationPair(pair),
    deletePolicy: pair.deletePolicy,
    intervalSeconds: pair.intervalSeconds,
    ignorePatterns: pair.ignorePatterns,
  }
}
