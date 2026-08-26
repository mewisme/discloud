import { Store } from "@tauri-apps/plugin-store"

export type DesktopPreferences = {
  closeToTray: boolean
  minimizeToTray: boolean
  notifications: boolean
}

const defaults: DesktopPreferences = {
  closeToTray: true,
  minimizeToTray: false,
  notifications: false,
}

let storePromise: Promise<Store> | undefined

export async function loadDesktopPreferences(): Promise<DesktopPreferences> {
  const store = await desktopPreferencesStore()
  const [closeToTray, minimizeToTray, notifications] = await Promise.all([
    store.get<boolean>("closeToTray"),
    store.get<boolean>("minimizeToTray"),
    store.get<boolean>("notifications"),
  ])

  return {
    closeToTray: closeToTray ?? defaults.closeToTray,
    minimizeToTray: minimizeToTray ?? defaults.minimizeToTray,
    notifications: notifications ?? defaults.notifications,
  }
}

export async function updateDesktopPreferences(patch: Partial<DesktopPreferences>) {
  const store = await desktopPreferencesStore()

  await Promise.all(Object.entries(patch).map(([key, value]) => store.set(key, value)))
  return loadDesktopPreferences()
}

function desktopPreferencesStore() {
  storePromise ??= Store.load("desktop-preferences.json", {
    autoSave: 100,
    defaults,
  })

  return storePromise
}
