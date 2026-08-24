import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"

import { nativeError } from "#lib/api/transport"

export interface DesktopLogFile {
  name: string
  size: number
}

export interface DesktopDiagnostics {
  directory: string
  files: DesktopLogFile[]
  totalSize: number
  tail: string
}

export function loadDesktopDiagnostics() {
  return invokeDiagnostics<DesktopDiagnostics>("get_desktop_diagnostics")
}

export function clearDesktopLogs() {
  return invokeDiagnostics<void>("clear_desktop_logs")
}

export function openDesktopLogFolder() {
  return invokeDiagnostics<void>("open_desktop_log_folder")
}

export async function exportDesktopLogs() {
  try {
    const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-")
    const destination = await save({ defaultPath: "discloud-desktop-logs-" + stamp + ".log", filters: [{ name: "Log", extensions: ["log"] }] })
    if (!destination) return false
    await invoke<void>("export_desktop_logs", { destination })
    return true
  } catch (error) {
    throw nativeError(error)
  }
}

async function invokeDiagnostics<T>(command: string) {
  try {
    return await invoke<T>(command)
  } catch (error) {
    throw nativeError(error)
  }
}
