import { listen } from "@tauri-apps/api/event"
import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

import { useDesktopSession } from "#components/desktop-session"

import { sendDesktopNotification } from "../../desktop/core/notifications"
import { clearNativeSyncPairState, configureNativeSyncPairs, listNativeSyncConflicts, openNativeSyncPath, resolveNativeSyncConflict, runNativeSyncPair, validateNativeSyncPairs } from "../core/native"
import { patchScopedSyncPair, scopedSyncPairs, syncPairsForValidation, type UpdateSyncPairInput } from "../core/pairs"
import { loadSyncPairs, saveSyncPairs } from "../core/preferences"
import type { SyncConflict, SyncConflictResolution, SyncPair, SyncPairRuntime, SyncRunResult } from "../core/types"

type CreateSyncPairInput = Omit<SyncPair, "id" | "serverUrl" | "username" | "createdAt">

type DesktopSyncContextValue = {
  pairs: SyncPair[]
  runtimes: Record<string, SyncPairRuntime>
  conflicts: SyncConflict[]
  loading: boolean
  error?: string
  addPair: (input: CreateSyncPairInput) => Promise<SyncPair>
  updatePair: (pairId: string, patch: UpdateSyncPairInput) => Promise<void>
  removePair: (pairId: string) => Promise<void>
  resetPairState: (pairId: string) => Promise<void>
  runPair: (pairId: string) => Promise<SyncRunResult | undefined>
  runAll: () => Promise<void>
  refreshConflicts: () => Promise<void>
  resolveConflict: (pairId: string, conflictId: string, resolution: SyncConflictResolution) => Promise<SyncRunResult | undefined>
  openLocalPath: (localPath: string) => Promise<void>
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
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])
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
  const pairs = useMemo(() => scopedSyncPairs(allPairs, scopeServerUrl, scopeUsername), [allPairs, scopeServerUrl, scopeUsername])

  const refreshConflicts = useCallback(async () => {
    const rows = await Promise.all(pairs.map((pair) => listNativeSyncConflicts(pair.id)))
    setConflicts(rows.flat())
  }, [pairs])

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
    await validateNativeSyncPairs(syncPairsForValidation(scopedSyncPairs(next, scopeServerUrl, scopeUsername), runningRef.current))
    await persist(next)
    return pair
  }, [persist, scopeServerUrl, scopeUsername])

  const updatePair = useCallback(async (pairId: string, patch: UpdateSyncPairInput) => {
    if (!scopeServerUrl || !scopeUsername) return
    const next = patchScopedSyncPair(allPairsRef.current, pairId, patch, scopeServerUrl, scopeUsername)
    if (!next) return
    await validateNativeSyncPairs(syncPairsForValidation(scopedSyncPairs(next, scopeServerUrl, scopeUsername), runningRef.current))
    await persist(next)
  }, [persist, scopeServerUrl, scopeUsername])

  const resetPairState = useCallback(async (pairId: string) => {
    if (runningRef.current.has(pairId)) throw new Error("Wait for this sync to finish before resetting its baseline.")
    await clearNativeSyncPairState(pairId)
    setConflicts((current) => current.filter((conflict) => conflict.pairId !== pairId))
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
    setConflicts((current) => current.filter((conflict) => conflict.pairId !== pairId))
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
      const validationPairs = syncPairsForValidation(scopedSyncPairs(allPairsRef.current, scopeServerUrl, scopeUsername), runningRef.current)
      await validateNativeSyncPairs(validationPairs)
      const result = await runNativeSyncPair(pair)
      const finishedAt = Date.now()
      const nextRunAt = finishedAt + pair.intervalSeconds * 1000
      setRuntimes((current) => ({ ...current, [pairId]: { status: "idle", lastStartedAt: startedAt, lastFinishedAt: finishedAt, nextRunAt, lastResult: result } }))
      await refreshConflicts().catch(() => undefined)
      window.dispatchEvent(new CustomEvent("discloud:sync-completed", { detail: { pairId, result } }))
      if (result.conflicts > 0) void sendDesktopNotification("Sync conflict needs attention", `${pair.remoteFolderName}: ${result.conflicts} pending conflict${result.conflicts === 1 ? "" : "s"}.`)
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
  }, [refreshConflicts, scopeServerUrl, scopeUsername])

  const runAll = useCallback(async () => {
    for (const pair of allPairsRef.current) {
      if (!pair.enabled || !scopeServerUrl || !scopeUsername || pair.serverUrl !== scopeServerUrl || pair.username !== scopeUsername) continue
      await runPair(pair.id).catch(() => undefined)
    }
  }, [runPair, scopeServerUrl, scopeUsername])

  useEffect(() => {
    void configureNativeSyncPairs(pairs).then(() => setError(undefined)).catch((cause) => setError(syncErrorMessage(cause)))
  }, [pairs])

  useEffect(() => {
    void refreshConflicts().catch((cause) => setError(syncErrorMessage(cause)))
  }, [refreshConflicts])

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
        void refreshConflicts().catch(() => undefined)
        window.dispatchEvent(new CustomEvent("discloud:sync-completed", { detail: { pairId: payload.pairId, result: payload.result } }))
        if (payload.result.conflicts > 0) void sendDesktopNotification("Sync conflict needs attention", `${pair.remoteFolderName}: ${payload.result.conflicts} pending conflict${payload.result.conflicts === 1 ? "" : "s"}.`)
      }
    }).then((unlisten) => {
      if (disposed) unlisten()
      else cleanups.push(unlisten)
    })

    return () => {
      disposed = true
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [refreshConflicts, runAll])

  const resolveConflict = useCallback(async (pairId: string, conflictId: string, resolution: SyncConflictResolution) => {
    if (runningRef.current.has(pairId)) return undefined
    const pair = pairs.find((item) => item.id === pairId)
    if (!pair) return undefined
    runningRef.current.add(pairId)
    const startedAt = Date.now()
    setRuntimes((current) => ({ ...current, [pairId]: { ...current[pairId], status: "syncing", lastStartedAt: startedAt, error: undefined } }))
    try {
      const result = await resolveNativeSyncConflict(pair, conflictId, resolution)
      const finishedAt = Date.now()
      setRuntimes((current) => ({ ...current, [pairId]: { status: "idle", lastStartedAt: startedAt, lastFinishedAt: finishedAt, nextRunAt: finishedAt + pair.intervalSeconds * 1000, lastResult: result } }))
      await refreshConflicts()
      window.dispatchEvent(new CustomEvent("discloud:sync-completed", { detail: { pairId, result } }))
      return result
    } catch (cause) {
      const message = syncErrorMessage(cause)
      const finishedAt = Date.now()
      setRuntimes((current) => ({ ...current, [pairId]: { ...current[pairId], status: "error", lastStartedAt: startedAt, lastFinishedAt: finishedAt, error: message } }))
      throw cause
    } finally {
      runningRef.current.delete(pairId)
    }
  }, [pairs, refreshConflicts])

  const openLocalPath = useCallback((localPath: string) => openNativeSyncPath(localPath), [])
  const value = useMemo<DesktopSyncContextValue>(() => ({ pairs, runtimes, conflicts, loading, error, addPair, updatePair, removePair, resetPairState, runPair, runAll, refreshConflicts, resolveConflict, openLocalPath }), [pairs, runtimes, conflicts, loading, error, addPair, updatePair, removePair, resetPairState, runPair, runAll, refreshConflicts, resolveConflict, openLocalPath])
  return <DesktopSyncContext.Provider value={value}>{children}</DesktopSyncContext.Provider>
}

export function useDesktopSync() {
  const context = useContext(DesktopSyncContext)
  if (!context) throw new Error("useDesktopSync must be used within DesktopSyncProvider")
  return context
}


function syncErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Sync failed."
}
