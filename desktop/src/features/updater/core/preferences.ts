import { Store } from "@tauri-apps/plugin-store"

export type UpdateChannel = "stable" | "rc" | "beta" | "alpha"

export type UpdaterPreferences = {
  checkOnStartup: boolean
  channel: UpdateChannel
}

const defaults: UpdaterPreferences = {
  checkOnStartup: true,
  channel: "stable",
}

let storePromise: Promise<Store> | undefined

export async function loadUpdaterPreferences(): Promise<UpdaterPreferences> {
  const store = await updaterPreferencesStore()
  const checkOnStartup = await store.get<boolean>("checkOnStartup")
  const channel = await store.get<string>("channel")

  return {
    checkOnStartup: checkOnStartup ?? defaults.checkOnStartup,
    channel: isUpdateChannel(channel) ? channel : defaults.channel,
  }
}

export async function updateUpdaterPreferences(patch: Partial<UpdaterPreferences>) {
  const store = await updaterPreferencesStore()

  await Promise.all(Object.entries(patch).map(([key, value]) => store.set(key, value)))
  return loadUpdaterPreferences()
}

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return value === "stable" || value === "rc" || value === "beta" || value === "alpha"
}

function updaterPreferencesStore() {
  storePromise ??= Store.load("updater-preferences.json", {
    autoSave: 100,
    defaults,
  })

  return storePromise
}
