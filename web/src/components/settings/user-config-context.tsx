"use client"

import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useState } from "react"
import type { UserConfig } from "@/lib/api/models"

type UserConfigContextValue = {
  config: UserConfig
  timezone: string
  setConfig: (config: UserConfig) => void
}

const UserConfigContext = createContext<UserConfigContextValue | null>(null)

export function UserConfigProvider({ initialConfig, children }: { initialConfig: UserConfig; children: ReactNode }) {
  const [config, setConfig] = useState(initialConfig)

  useEffect(() => {
    setConfig(initialConfig)
  }, [initialConfig])

  return (
    <UserConfigContext.Provider value={{ config, timezone: config.common.timezone || "UTC", setConfig }}>
      {children}
    </UserConfigContext.Provider>
  )
}

export function useUserConfig() {
  const context = useContext(UserConfigContext)
  if (!context) throw new Error("useUserConfig must be used inside UserConfigProvider")
  return context
}