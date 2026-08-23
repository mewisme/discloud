import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"

import { nativeError } from "#lib/api/transport"

import type { SyncPair, SyncRunResult } from "./types"

export async function pickSyncFolder() {
  const path = await open({ directory: true, multiple: false, title: "Choose a local folder to sync" })
  return typeof path === "string" ? path : undefined
}

export async function runNativeSyncPair(pair: SyncPair) {
  try {
    return await invoke<SyncRunResult>("run_sync_pair", { pair: nativeSyncPair(pair) })
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
