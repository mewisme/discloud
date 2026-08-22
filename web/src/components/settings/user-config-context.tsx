"use client"

import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useState } from "react"
import { useStore } from "zustand"
import { createStore, type StoreApi } from "zustand/vanilla"

import type { UserConfig } from "@/lib/api/models"

type UserConfigStoreState = {
  config: UserConfig
  setConfig: (config: UserConfig) => void
}

type UserConfigStore = StoreApi<UserConfigStoreState>

const UserConfigStoreContext = createContext<UserConfigStore | null>(null)

function createUserConfigStore(initialConfig: UserConfig): UserConfigStore {
  return createStore<UserConfigStoreState>((set) => ({
    config: initialConfig,
    setConfig: (config) => set({ config }),
  }))
}

export function UserConfigProvider({
  initialConfig,
  children,
}: {
  initialConfig: UserConfig
  children: ReactNode
}) {
  const [store] = useState(() => createUserConfigStore(initialConfig))

  useEffect(() => {
    if (store.getState().config !== initialConfig) {
      store.setState({ config: initialConfig })
    }
  }, [initialConfig, store])

  return (
    <UserConfigStoreContext.Provider value={store}>
      {children}
    </UserConfigStoreContext.Provider>
  )
}

export function useUserConfigSelector<T>(selector: (config: UserConfig) => T): T {
  const store = useUserConfigStore()
  return useStore(store, (state) => selector(state.config))
}

export function useSetUserConfig() {
  return useUserConfigStore().getState().setConfig
}

export function useUserConfig() {
  const config = useUserConfigSelector((value) => value)
  const setConfig = useSetUserConfig()

  return {
    config,
    timezone: config.common.timezone || "UTC",
    setConfig,
  }
}

function useUserConfigStore() {
  const store = useContext(UserConfigStoreContext)
  if (!store) throw new Error("useUserConfig must be used inside UserConfigProvider")
  return store
}