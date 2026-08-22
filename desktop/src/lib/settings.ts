import { LazyStore } from "@tauri-apps/plugin-store"

const settings = new LazyStore("settings.json")
const SERVER_URL_KEY = "serverUrl"

export async function loadServerUrl() {
  const value = await settings.get<unknown>(SERVER_URL_KEY)

  return typeof value === "string" && value.trim() ? value : null
}

export async function saveServerUrl(serverUrl: string) {
  await settings.set(SERVER_URL_KEY, serverUrl)
  await settings.save()
}