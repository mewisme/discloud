import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart"
import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { setNativeCloseToTray, setNativeMinimizeToTray } from "../core/native"
import { desktopNotificationPermissionGranted, requestDesktopNotificationPermission, sendDesktopNotification } from "../core/notifications"
import { type DesktopPreferences, loadDesktopPreferences, updateDesktopPreferences } from "../core/preferences"

type DesktopRuntimeContextValue = {
  preferences?: DesktopPreferences
  autostartEnabled: boolean
  notificationPermissionGranted: boolean
  loading: boolean
  error?: string
  setCloseToTray: (enabled: boolean) => Promise<void>
  setMinimizeToTray: (enabled: boolean) => Promise<void>
  setAutostart: (enabled: boolean) => Promise<void>
  setNotifications: (enabled: boolean) => Promise<void>
  testNotification: () => Promise<boolean>
  reload: () => void
}

const DesktopRuntimeContext = createContext<DesktopRuntimeContextValue | null>(null)

export function DesktopRuntimeProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<DesktopPreferences>()
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [notificationPermissionGranted, setNotificationPermissionGranted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(undefined)

      try {
        const [nextPreferences, nextAutostart, nextNotificationPermission] = await Promise.all([
          loadDesktopPreferences(),
          isEnabled(),
          desktopNotificationPermissionGranted(),
        ])

        await Promise.all([
          setNativeCloseToTray(nextPreferences.closeToTray),
          setNativeMinimizeToTray(nextPreferences.minimizeToTray),
        ])

        if (!cancelled) {
          setPreferences(nextPreferences)
          setAutostartEnabled(nextAutostart)
          setNotificationPermissionGranted(nextNotificationPermission)
        }
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : "Could not load desktop preferences.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [version])

  const setCloseToTray = useCallback(async (enabled: boolean) => {
    await setNativeCloseToTray(enabled)
    const next = await updateDesktopPreferences({ closeToTray: enabled })
    setPreferences(next)
  }, [])

  const setMinimizeToTray = useCallback(async (enabled: boolean) => {
    await setNativeMinimizeToTray(enabled)
    const next = await updateDesktopPreferences({ minimizeToTray: enabled })
    setPreferences(next)
  }, [])

  const setAutostart = useCallback(async (enabled: boolean) => {
    if (enabled) await enable()
    else await disable()

    setAutostartEnabled(await isEnabled())
  }, [])

  const setNotifications = useCallback(async (enabled: boolean) => {
    if (enabled && !await requestDesktopNotificationPermission()) {
      setNotificationPermissionGranted(false)
      throw new Error("Notification permission was not granted by the operating system.")
    }

    const next = await updateDesktopPreferences({ notifications: enabled })
    setPreferences(next)
    setNotificationPermissionGranted(await desktopNotificationPermissionGranted())
  }, [])

  const testNotification = useCallback(async () => {
    const granted = await requestDesktopNotificationPermission()
    setNotificationPermissionGranted(granted)
    if (!granted) return false
    return sendDesktopNotification("DisCloud notifications are ready", "Upload completion and failures can now appear as native notifications.", { force: true })
  }, [])

  const reload = useCallback(() => setVersion((value) => value + 1), [])

  const value = useMemo<DesktopRuntimeContextValue>(() => ({
    preferences,
    autostartEnabled,
    notificationPermissionGranted,
    loading,
    error,
    setCloseToTray,
    setMinimizeToTray,
    setAutostart,
    setNotifications,
    testNotification,
    reload,
  }), [preferences, autostartEnabled, notificationPermissionGranted, loading, error, setCloseToTray, setMinimizeToTray, setAutostart, setNotifications, testNotification, reload])

  return <DesktopRuntimeContext.Provider value={value}>{children}</DesktopRuntimeContext.Provider>
}

export function useDesktopRuntime() {
  const context = useContext(DesktopRuntimeContext)
  if (!context) throw new Error("useDesktopRuntime must be used within DesktopRuntimeProvider")
  return context
}
