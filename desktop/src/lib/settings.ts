import { LazyStore } from "@tauri-apps/plugin-store"

const settings = new LazyStore("settings.json")
const CONNECTION_MODE_KEY = "connectionMode"
const SERVER_URL_KEY = "serverUrl"

export type ConnectionMode = "remote" | "local"

export async function loadConnectionSettings(): Promise<{ mode: ConnectionMode | null; serverUrl: string | null }> {
  const [modeValue, serverUrlValue] = await Promise.all([settings.get<unknown>(CONNECTION_MODE_KEY), settings.get<unknown>(SERVER_URL_KEY)])
  const serverUrl = typeof serverUrlValue === "string" && serverUrlValue.trim() ? serverUrlValue : null
  const mode = modeValue === "remote" || modeValue === "local" ? modeValue : serverUrl ? "remote" : null
  return { mode, serverUrl }
}

export async function saveConnectionMode(mode: ConnectionMode) {
  await settings.set(CONNECTION_MODE_KEY, mode)
  await settings.save()
}

export async function saveRemoteConnection(serverUrl: string) {
  await settings.set(CONNECTION_MODE_KEY, "remote")
  await settings.set(SERVER_URL_KEY, serverUrl)
  await settings.save()
}
