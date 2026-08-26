import { invoke } from "@tauri-apps/api/core"

import { nativeError } from "#lib/api/transport"

export async function setNativeCloseToTray(enabled: boolean) {
  try {
    await invoke<void>("set_close_to_tray", { enabled })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function setNativeMinimizeToTray(enabled: boolean) {
  try {
    await invoke<void>("set_minimize_to_tray", { enabled })
  } catch (error) {
    throw nativeError(error)
  }
}
