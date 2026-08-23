import { listen } from "@tauri-apps/api/event"
import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

import { useDesktopSession } from "#components/desktop-session"

import { sendDesktopNotification } from "../../desktop/core/notifications"
import { clearNativeSyncPairState, configureNativeSyncPairs, runNativeSyncPair, validateNativeSyncPairs } from "../core/native"
import { loadSyncPairs, saveSyncPairs } from "../core/preferences"
import type { SyncPair, SyncPairRuntime, SyncRunResult } from "../core/types"

type CreateSyncPairInput = Omit<SyncPair, "id" | "serverUrl" | "username" | "createdAt">
type UpdateSyncPairInput = Partial<Pick<SyncPair, "remoteFolderName" | "enabled" | "direction" | "deletePolicy" | "intervalSeconds" | "ignorePatterns">>

type DesktopSyncContextValue = {
  pairs: SyncPair[]
  runtimes: Record<string, SyncPairRuntime>
  loading: boolean
  error?: string
  addPair: (input: CreateSyncPairInput) => Promise<SyncPair>
  updatePair: (pairId: string, patch: UpdateSyncPairInput) => Promise<void>
  removePair: (pairId: string) => Promise<void>
  resetPairState: (pairId: string) => Promise<void>
  runPair: (pairId: string) => Promise<SyncRunResult | undefined>
  runAll: () => Promise<void>
}

const DesktopSyncContext = createContext<DesktopSyncContextValue | null>(null)

type NativeSyncRunEvent = {
  stage: "started" | "finished"
  pairId: string
  startedAt: number
  finishedAt?: number
  result?: SyncRunResult
  error?: string
}

export function DesktopSyncProvider({ children }: { children: ReactNode }) {
  const { state } = useDesktopSession()
  const [allPairs, setAllPairs] = useState<SyncPair[]>([])
  const [runtimes, setRuntimes] = useState<Record<string, SyncPairRuntime>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const allPairsRef = useRef<SyncPair[]>([])
  const runningRef = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false

    loadSyncPairs().then((pairs) => {
      if (cancelled) return
      allPairsRef.current = pairs
      setAllPairs(pairs)
    }).catch((cause) => {
      if (!cancelled) setError(syncErrorMessage(cause))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const scopeServerUrl = state.status === "connected" && state.user ? state.serverUrl : undefined
  const scopeUsername = state.status === "connected" && state.user ? state.user.username : undefined
  const pairs = useMemo(() => scopedPairs(allPairs, scopeServerUrl, scopeUsername), [allPairs, scopeServerUrl, scopeUsername])

  const persist = useCallback(async (next: SyncPair[]) => {
    try {
      await saveSyncPairs(next)
      allPairsRef.current = next
      setAllPairs(next)
      setError(undefined)
    } catch (cause) {
      const message = syncErrorMessage(cause)
      setError(message)
      throw cause
    }
  }, [])

  const addPair = useCallback(async (input: CreateSyncPairInput) => {
    if (!scopeServerUrl || !scopeUsername) throw new Error("Sign in before creating a sync pair.")

    const pair: SyncPair = { ...input, id: crypto.randomUUID(), serverUrl: scopeServerUrl, username: scopeUsername, createdAt: Date.now() }
    const next = [...allPairsRef.current, pair]
    await validateNativeSyncPairs(scopedPairs(next, scopeServerUrl, scopeUsername).map((item) => ({ ...item, enabled: item.enabled || runningRef.current.has(item.id) })))
    await persist(next)
    return pair
  }, [persist, scopeServerUrl, scopeUsername])

  const updatePair = useCallback(async (pairId: string, patch: UpdateSyncPairInput) => {
    const current = allPairsRef.current.find((pair) => pair.id === pairId)
    if (!current || !scopeServerUrl || !scopeUsername || current.serverUrl !== scopeServerUrl || current.username !== scopeUsername) return

    const next = allPairsRef.current.map((pair) => pair.id === pairId ? { ...pair, ...patch } : pair)
    await validateNativeSyncPairs(scopedPairs(next, scopeServerUrl, scopeUsername).map((item) => ({ ...item, enabled: item.enabled || runningRef.current.has(item.id) })))
    await persist(next)
  }, [persist, scopeServerUrl, scopeUsername])

  const resetPairState = useCallback(async (pairId: string) => {
    if (runningRef.current.has(pairId)) throw new Error("Wait for this sync to finish before resetting its baseline.")
    await clearNativeSyncPairState(pairId)
    setRuntimes((current) => ({ ...current, [pairId]: { status: "idle" } }))
  }, [])

  const removePair = useCallback(async (pairId: string) => {
    if (runningRef.current.has(pairId)) throw new Error("Wait for this sync to finish before removing it.")
    const current = allPairsRef.current.find((pair) => pair.id === pairId)
    if (!current || !scopeServerUrl || !scopeUsername || current.serverUrl !== scopeServerUrl || current.username !== scopeUsername) return
    await clearNativeSyncPairState(pairId).catch(() => undefined)
    setRuntimes((current) => {
      const next = { ...current }
      delete next[pairId]
      return next
    })
    await persist(allPairsRef.current.filter((pair) => pair.id !== pairId))
  }, [persist, scopeServerUrl, scopeUsername])

  const runPair = useCallback(async (pairId: string) => {
    if (runningRef.current.has(pairId)) return undefined
    const pair = allPairsRef.current.find((item) => item.id === pairId)
    if (!pair || !scopeServerUrl || !scopeUsername || pair.serverUrl !== scopeServerUrl || pair.username !== scopeUsername) return undefined

    runningRef.current.add(pairId)
    const startedAt = Date.now()
    setRuntimes((current) => ({ ...current, [pairId]: { ...current[pairId], status: "syncing", lastStartedAt: startedAt, error: undefined } }))

    try {
      const validationPairs = scopedPairs(allPairsRef.current, scopeServerUrl, scopeUsername).map((item) => ({ ...item, enabled: item.enabled || runningRef.current.has(item.id) }))
      await validateNativeSyncPairs(validationPairs)
      const result = await runNativeSyncPair(pair)
      const finishedAt = Date.now()
      const nextRunAt = finishedAt + pair.intervalSeconds * 1000
      setRuntimes((current) => ({ ...current, [pairId]: { status: "idle", lastStartedAt: startedAt, lastFinishedAt: finishedAt, nextRunAt, lastResult: result } }))
      window.dispatchEvent(new CustomEvent("discloud:sync-completed", { detail: { pairId, result } }))
      if (result.conflicts > 0) void sendDesktopNotification("DisCloud sync preserved a conflict", `${pair.remoteFolderName}: ${result.conflicts} conflict${result.conflicts === 1 ? "" : "s"} kept as separate copies.`)
      return result
    } catch (cause) {
      const message = syncErrorMessage(cause)
      const finishedAt = Date.now()
      setRuntimes((current) => ({ ...current, [pairId]: { ...current[pairId], status: "error", lastStartedAt: startedAt, lastFinishedAt: finishedAt, nextRunAt: finishedAt + pair.intervalSeconds * 1000, error: message } }))
      void sendDesktopNotification("DisCloud sync failed", `${pair.remoteFolderName}: ${message}`)
      throw cause
    } finally {
      runningRef.current.delete(pairId)
    }
  }, [scopeServerUrl, scopeUsername])

  const runAll = useCallback(async () => {
    for (const pair of allPairsRef.current) {
      if (!pair.enabled || !scopeServerUrl || !scopeUsername || pair.serverUrl !== scopeServerUrl || pair.username !== scopeUsername) continue
      await runPair(pair.id).catch(() => undefined)
    }
  }, [runPair, scopeServerUrl, scopeUsername])

  useEffect(() => {
    void configureNativeSyncPairs(pairs).then(() => setError(undefined)).catch((cause) => setError(syncErrorMessage(cause)))
  }, [pairs])

  useEffect(() => () => {
    void configureNativeSyncPairs([]).catch(() => undefined)
  }, [])

  useEffect(() => {
    let disposed = false
    const cleanups: Array<() => void> = []

    void listen("desktop-sync-requested", () => void runAll()).then((unlisten) => {
      if (disposed) unlisten()
      else cleanups.push(unlisten)
    })

    void listen<NativeSyncRunEvent>("desktop-sync-run", (event) => {
      const payload = event.payload
      const pair = allPairsRef.current.find((item) => item.id === payload.pairId)
      if (!pair) return

      if (payload.stage === "started") {
        runningRef.current.add(payload.pairId)
        setRuntimes((current) => ({ ...current, [payload.pairId]: { ...current[payload.pairId], status: "syncing", lastStartedAt: payload.startedAt, error: undefined } }))
        return
      }

      const finishedAt = payload.finishedAt ?? Date.now()
      runningRef.current.delete(payload.pairId)
      if (payload.error) {
        setRuntimes((current) => ({ ...current, [payload.pairId]: { ...current[payload.pairId], status: "error", lastStartedAt: payload.startedAt, lastFinishedAt: finishedAt, nextRunAt: finishedAt + pair.intervalSeconds * 1000, error: payload.error } }))
        void sendDesktopNotification("DisCloud sync failed", `${pair.remoteFolderName}: ${payload.error}`)
        return
      }

      if (payload.result) {
        setRuntimes((current) => ({ ...current, [payload.pairId]: { status: "idle", lastStartedAt: payload.startedAt, lastFinishedAt: finishedAt, nextRunAt: finishedAt + pair.intervalSeconds * 1000, lastResult: payload.result } }))
        window.dispatchEvent(new CustomEvent("discloud:sync-completed", { detail: { pairId: payload.pairId, result: payload.result } }))
        if (payload.result.conflicts > 0) void sendDesktopNotification("DisCloud sync preserved a conflict", `${pair.remoteFolderName}: ${payload.result.conflicts} conflict${payload.result.conflicts === 1 ? "" : "s"} kept as separate copies.`)
      }
    }).then((unlisten) => {
      if (disposed) unlisten()
      else cleanups.push(unlisten)
    })

    return () => {
      disposed = true
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [runAll])

  const value = useMemo<DesktopSyncContextValue>(() => ({ pairs, runtimes, loading, error, addPair, updatePair, removePair, resetPairState, runPair, runAll }), [pairs, runtimes, loading, error, addPair, updatePair, removePair, resetPairState, runPair, runAll])
  return <DesktopSyncContext.Provider value={value}>{children}</DesktopSyncContext.Provider>
}

export function useDesktopSync() {
  const context = useContext(DesktopSyncContext)
  if (!context) throw new Error("useDesktopSync must be used within DesktopSyncProvider")
  return context
}

function scopedPairs(pairs: readonly SyncPair[], serverUrl?: string, username?: string) {
  if (!serverUrl || !username) return []
  return pairs.filter((pair) => pair.serverUrl === serverUrl && pair.username === username)
}

function syncErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Sync failed."
}
