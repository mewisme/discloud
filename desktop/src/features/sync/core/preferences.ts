import { Store } from "@tauri-apps/plugin-store"

import { normalizeSyncPair } from "./pairs"
import type { SyncPair } from "./types"

const storeDefaults = { pairs: [] as SyncPair[] }
let storePromise: Promise<Store> | undefined

export async function loadSyncPairs() {
  const store = await syncStore()
  const value = await store.get<unknown>("pairs")
  const pairs = Array.isArray(value) ? value.filter(isSyncPair) : []
  const normalized = pairs.map(normalizeSyncPair)
  if (normalized.some((pair, index) => pair !== pairs[index])) await store.set("pairs", normalized)
  return normalized
}

export async function saveSyncPairs(pairs: readonly SyncPair[]) {
  const store = await syncStore()
  const normalized = pairs.map(normalizeSyncPair)
  await store.set("pairs", normalized)
  return normalized
}

function syncStore() {
  storePromise ??= Store.load("sync-pairs.json", { autoSave: 100, defaults: storeDefaults })
  return storePromise
}

function isSyncPair(value: unknown): value is SyncPair {
  if (!value || typeof value !== "object") return false
  const pair = value as Record<string, unknown>
  return typeof pair.id === "string"
    && typeof pair.serverUrl === "string"
    && typeof pair.username === "string"
    && typeof pair.localPath === "string"
    && typeof pair.remoteFolderId === "string"
    && typeof pair.remoteFolderName === "string"
    && typeof pair.enabled === "boolean"
    && ["two-way", "download-only", "upload-only"].includes(String(pair.direction))
    && ["preserve", "propagate"].includes(String(pair.deletePolicy))
    && typeof pair.intervalSeconds === "number"
    && Number.isFinite(pair.intervalSeconds)
    && pair.intervalSeconds >= 15
    && Array.isArray(pair.ignorePatterns)
    && pair.ignorePatterns.every((item) => typeof item === "string")
    && typeof pair.createdAt === "number"
}
