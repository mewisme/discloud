import type { SetupStatus } from "@discloud/api/models"
import { invoke } from "@tauri-apps/api/core"
import { apiJSON, nativeError } from "#lib/api/transport"

type ConnectedServer = {
  serverUrl: string
}

export type ServerConnection = {
  serverUrl: string
  setupRequired: SetupStatus["setupRequired"]
}

export async function connectServer(serverUrl: string): Promise<ServerConnection> {
  let connected: ConnectedServer

  try {
    connected = await invoke<ConnectedServer>("connect_server", { serverUrl })
  } catch (error) {
    throw nativeError(error)
  }

  try {
    const status = await apiJSON<SetupStatus>("/api/v1/setup/status")

    return {
      serverUrl: connected.serverUrl,
      setupRequired: status.setupRequired,
    }
  } catch (error) {
    try {
      await disconnectServer()
    } catch {
      // Preserve the original API error.
    }

    throw error
  }
}

export async function disconnectServer() {
  try {
    await invoke("disconnect_server")
  } catch (error) {
    throw nativeError(error)
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error

  return "An unexpected error occurred."
}