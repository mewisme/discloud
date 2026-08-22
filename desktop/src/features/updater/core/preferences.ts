import { Store } from "@tauri-apps/plugin-store"

export type UpdaterPreferences = {
  checkOnStartup: boolean
}

const defaults: UpdaterPreferences = {
  checkOnStartup: true,
}

let storePromise: Promise<Store> | undefined

export async function loadUpdaterPreferences(): Promise<UpdaterPreferences> {
  const store = await updaterPreferencesStore()
  const checkOnStartup = await store.get<boolean>("checkOnStartup")

  return {
    checkOnStartup: checkOnStartup ?? defaults.checkOnStartup,
  }
}

export async function updateUpdaterPreferences(patch: Partial<UpdaterPreferences>) {
  const store = await updaterPreferencesStore()

  await Promise.all(Object.entries(patch).map(([key, value]) => store.set(key, value)))
  return loadUpdaterPreferences()
}

function updaterPreferencesStore() {
  storePromise ??= Store.load("updater-preferences.json", {
    autoSave: 100,
    defaults,
  })

  return storePromise
}
