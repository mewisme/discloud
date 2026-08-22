import { getCurrentWindow } from "@tauri-apps/api/window"
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"

import { loadDesktopPreferences } from "./preferences"

export async function desktopNotificationPermissionGranted() {
  return isPermissionGranted()
}

export async function requestDesktopNotificationPermission() {
  if (await isPermissionGranted()) return true
  return await requestPermission() === "granted"
}

export async function sendDesktopNotification(title: string, body: string, options: { force?: boolean } = {}) {
  if (!options.force) {
    const preferences = await loadDesktopPreferences()
    if (!preferences.notifications) return false

    try {
      if (await getCurrentWindow().isFocused()) return false
    } catch {
      // nothing here
    }
  }

  if (!await isPermissionGranted()) return false

  sendNotification({ title, body })
  return true
}
