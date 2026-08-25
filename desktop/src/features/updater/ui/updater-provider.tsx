import { getVersion } from "@tauri-apps/api/app"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

import { loadUpdaterPreferences, type UpdateChannel, type UpdaterPreferences, updateUpdaterPreferences } from "../core/preferences"

export type DesktopUpdateInfo = {
  currentVersion: string
  version: string
  date?: string
  body?: string
}

export type DesktopUpdaterStage = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "installing" | "error"

type DesktopUpdaterProgress = {
  event: "started" | "progress" | "installing"
  downloadedBytes: number
  totalBytes?: number
}

type DesktopUpdaterContextValue = {
  currentVersion?: string
  preferences?: UpdaterPreferences
  stage: DesktopUpdaterStage
  update?: DesktopUpdateInfo
  downloadedBytes: number
  totalBytes?: number
  lastCheckedAt?: number
  error?: string
  checkForUpdates: () => Promise<void>
  installUpdate: () => Promise<void>
  setCheckOnStartup: (enabled: boolean) => Promise<void>
  setChannel: (channel: UpdateChannel) => Promise<void>
}

const DesktopUpdaterContext = createContext<DesktopUpdaterContextValue | null>(null)
const PROGRESS_EVENT = "desktop-updater-progress"

export function DesktopUpdaterProvider({ children }: { children: ReactNode }) {
  const [currentVersion, setCurrentVersion] = useState<string>()
  const [preferences, setPreferences] = useState<UpdaterPreferences>()
  const [stage, setStage] = useState<DesktopUpdaterStage>("idle")
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateInfo>()
  const [downloadedBytes, setDownloadedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState<number>()
  const [lastCheckedAt, setLastCheckedAt] = useState<number>()
  const [error, setError] = useState<string>()
  const busyRef = useRef(false)
  const autoCheckedRef = useRef(false)
  const preferencesRef = useRef<UpdaterPreferences | undefined>(undefined)

  useEffect(() => {
    preferencesRef.current = preferences
  }, [preferences])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [version, nextPreferences] = await Promise.all([
          getVersion(),
          loadUpdaterPreferences(),
        ])

        if (!cancelled) {
          setCurrentVersion(version)
          setPreferences(nextPreferences)
          preferencesRef.current = nextPreferences
        }
      } catch (cause) {
        if (!cancelled) {
          setStage("error")
          setError(updaterErrorMessage(cause))
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const checkChannel = useCallback(async (channel: UpdateChannel) => {
    if (busyRef.current) return

    busyRef.current = true
    setStage("checking")
    setError(undefined)
    setUpdateInfo(undefined)
    setDownloadedBytes(0)
    setTotalBytes(undefined)

    try {
      const update = await invoke<DesktopUpdateInfo | null>("check_for_update", { channel })
      setLastCheckedAt(Date.now())

      if (!update) {
        setStage("up-to-date")
        return
      }

      setUpdateInfo(update)
      setStage("available")
    } catch (cause) {
      setStage("error")
      setError(updaterErrorMessage(cause))
    } finally {
      busyRef.current = false
    }
  }, [])

  const checkForUpdates = useCallback(async () => {
    await checkChannel(preferencesRef.current?.channel ?? "stable")
  }, [checkChannel])

  useEffect(() => {
    if (!preferences || autoCheckedRef.current || !import.meta.env.PROD) return

    autoCheckedRef.current = true
    if (preferences.checkOnStartup) void checkChannel(preferences.channel)
  }, [preferences, checkChannel])

  const installUpdate = useCallback(async () => {
    if (!updateInfo || busyRef.current) return

    const channel = preferencesRef.current?.channel ?? "stable"
    busyRef.current = true
    setStage("downloading")
    setDownloadedBytes(0)
    setTotalBytes(undefined)
    setError(undefined)

    const unlisten = await listen<DesktopUpdaterProgress>(PROGRESS_EVENT, ({ payload }) => {
      switch (payload.event) {
        case "started":
          setStage("downloading")
          setDownloadedBytes(0)
          setTotalBytes(payload.totalBytes)
          break
        case "progress":
          setStage("downloading")
          setDownloadedBytes(payload.downloadedBytes)
          if (payload.totalBytes !== undefined) setTotalBytes(payload.totalBytes)
          break
        case "installing":
          setStage("installing")
          break
      }
    })

    try {
      await invoke<void>("install_update", { channel })
    } catch (cause) {
      setStage("available")
      setError(updaterErrorMessage(cause))
    } finally {
      unlisten()
      busyRef.current = false
    }
  }, [updateInfo])

  const setCheckOnStartup = useCallback(async (enabled: boolean) => {
    const next = await updateUpdaterPreferences({ checkOnStartup: enabled })
    preferencesRef.current = next
    setPreferences(next)
  }, [])

  const setChannel = useCallback(async (channel: UpdateChannel) => {
    if (busyRef.current) return

    const next = await updateUpdaterPreferences({ channel })
    preferencesRef.current = next
    setPreferences(next)
    setStage("idle")
    setUpdateInfo(undefined)
    setDownloadedBytes(0)
    setTotalBytes(undefined)
    setLastCheckedAt(undefined)
    setError(undefined)
  }, [])

  const value = useMemo<DesktopUpdaterContextValue>(() => ({
    currentVersion,
    preferences,
    stage,
    update: updateInfo,
    downloadedBytes,
    totalBytes,
    lastCheckedAt,
    error,
    checkForUpdates,
    installUpdate,
    setCheckOnStartup,
    setChannel,
  }), [currentVersion, preferences, stage, updateInfo, downloadedBytes, totalBytes, lastCheckedAt, error, checkForUpdates, installUpdate, setCheckOnStartup, setChannel])

  return <DesktopUpdaterContext.Provider value={value}>{children}</DesktopUpdaterContext.Provider>
}

export function useDesktopUpdater() {
  const context = useContext(DesktopUpdaterContext)
  if (!context) throw new Error("useDesktopUpdater must be used within DesktopUpdaterProvider")
  return context
}

function updaterErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Desktop update action failed."
}
