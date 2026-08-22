import type { UserConfig } from "@discloud/api/models"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { errorMessage } from "#lib/instance"

import { loadUserConfig } from "../core/config"

type DesktopUserConfigContextValue = {
  config?: UserConfig
  loading: boolean
  error?: string
  setConfig: (config: UserConfig) => void
  reload: () => void
}

const DesktopUserConfigContext = createContext<DesktopUserConfigContextValue | null>(null)

export function DesktopUserConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<UserConfig>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(undefined)

      try {
        const next = await loadUserConfig()
        if (!cancelled) setConfig(next)
      } catch (error) {
        if (!cancelled) setError(errorMessage(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [version])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  const value = useMemo<DesktopUserConfigContextValue>(() => ({ config, loading, error, setConfig, reload }), [config, loading, error, reload])

  return <DesktopUserConfigContext.Provider value={value}>{children}</DesktopUserConfigContext.Provider>
}

export function useDesktopUserConfig() {
  const context = useContext(DesktopUserConfigContext)
  if (!context) throw new Error("useDesktopUserConfig must be used inside DesktopUserConfigProvider")
  return context
}
