import { getVersion } from "@tauri-apps/api/app"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

import { loadUpdaterPreferences, type UpdaterPreferences, updateUpdaterPreferences } from "../core/preferences"

export type DesktopUpdateInfo = {
  currentVersion: string
  version: string
  date?: string
  body?: string
}

export type DesktopUpdaterStage = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "installing" | "error"

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
}

const DesktopUpdaterContext = createContext<DesktopUpdaterContextValue | null>(null)
const CHECK_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000

export function DesktopUpdaterProvider({ children }: { children: ReactNode }) {
  const [currentVersion, setCurrentVersion] = useState<string>()
  const [preferences, setPreferences] = useState<UpdaterPreferences>()
  const [stage, setStage] = useState<DesktopUpdaterStage>("idle")
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateInfo>()
  const [downloadedBytes, setDownloadedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState<number>()
  const [lastCheckedAt, setLastCheckedAt] = useState<number>()
  const [error, setError] = useState<string>()
  const updateRef = useRef<Update | undefined>(undefined)
  const busyRef = useRef(false)
  const autoCheckedRef = useRef(false)

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
      const pending = updateRef.current
      updateRef.current = undefined
      if (pending) void pending.close().catch(() => undefined)
    }
  }, [])

  const checkForUpdates = useCallback(async () => {
    if (busyRef.current) return

    busyRef.current = true
    setStage("checking")
    setError(undefined)
    setUpdateInfo(undefined)
    setDownloadedBytes(0)
    setTotalBytes(undefined)

    try {
      const previous = updateRef.current
      updateRef.current = undefined
      if (previous) await previous.close().catch(() => undefined)

      const update = await check({ timeout: CHECK_TIMEOUT_MS })
      setLastCheckedAt(Date.now())

      if (!update) {
        setUpdateInfo(undefined)
        setStage("up-to-date")
        return
      }

      updateRef.current = update
      setUpdateInfo({
        currentVersion: update.currentVersion,
        version: update.version,
        date: update.date,
        body: update.body,
      })
      setStage("available")
    } catch (cause) {
      setStage("error")
      setError(updaterErrorMessage(cause))
    } finally {
      busyRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!preferences || autoCheckedRef.current || !import.meta.env.PROD) return

    autoCheckedRef.current = true
    if (preferences.checkOnStartup) void checkForUpdates()
  }, [preferences, checkForUpdates])

  const installUpdate = useCallback(async () => {
    const update = updateRef.current
    if (!update || busyRef.current) return

    busyRef.current = true
    setStage("downloading")
    setDownloadedBytes(0)
    setTotalBytes(undefined)
    setError(undefined)

    let downloaded = 0

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            downloaded = 0
            setDownloadedBytes(0)
            setTotalBytes(event.data.contentLength ?? undefined)
            break
          case "Progress":
            downloaded += event.data.chunkLength
            setDownloadedBytes(downloaded)
            break
          case "Finished":
            setStage("installing")
            break
        }
      }, { timeout: DOWNLOAD_TIMEOUT_MS })

      setStage("installing")
      await relaunch()
    } catch (cause) {
      setStage("available")
      setError(updaterErrorMessage(cause))
    } finally {
      busyRef.current = false
    }
  }, [])

  const setCheckOnStartup = useCallback(async (enabled: boolean) => {
    const next = await updateUpdaterPreferences({ checkOnStartup: enabled })
    setPreferences(next)
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
  }), [currentVersion, preferences, stage, updateInfo, downloadedBytes, totalBytes, lastCheckedAt, error, checkForUpdates, installUpdate, setCheckOnStartup])

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
