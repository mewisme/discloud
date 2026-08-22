import { invoke } from "@tauri-apps/api/core"

export type ServerConnection = {
  serverUrl: string
  setupRequired: boolean
}

export function probeServer(serverUrl: string) {
  return invoke<ServerConnection>("probe_server", { serverUrl })
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error

  return "An unexpected error occurred."
}