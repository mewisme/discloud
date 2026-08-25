import { invoke } from "@tauri-apps/api/core"

import { nativeError } from "#lib/api/transport"

export type LocalRuntimeStatus = "disabled" | "preparing" | "stopped" | "downloading" | "initializingDatabase" | "startingDatabase" | "databaseReady" | "startingBackend" | "ready" | "degraded" | "failed" | "stopping"

export type LocalRuntimeComponent = {
  kind: "backend" | "postgresql" | "web"
  version: string
  target: string
  archiveName: string
  downloadUrl: string
  checksumUrl: string
  optional: boolean
}

export type LocalRuntimeManifest = {
  schemaVersion: number
  desktopVersion: string
  components: {
    backend: LocalRuntimeComponent
    postgresql: LocalRuntimeComponent
    web: LocalRuntimeComponent | null
  }
}

export type PostgresqlRuntimeSnapshot = {
  installed: boolean
  initialized: boolean
  running: boolean
  version: string | null
  port: number | null
}

export type BackendRuntimeSnapshot = {
  installed: boolean
  desiredInstalled: boolean
  running: boolean
  version: string | null
  desiredVersion: string
  previousVersion: string | null
  port: number | null
}

export type LocalRuntimeSnapshot = {
  status: LocalRuntimeStatus
  paths: {
    rootDir: string
    runtimeDir: string
    backendDir: string
    postgresqlDir: string
    webDir: string
    stagingDir: string
    postgresDataDir: string
    configPath: string
    manifestPath: string
    postgresqlStatePath: string
    backendStatePath: string
    backendShutdownPath: string
    logsDir: string
  } | null
  manifest: LocalRuntimeManifest | null
  postgresql: PostgresqlRuntimeSnapshot | null
  backend: BackendRuntimeSnapshot | null
  error: string | null
}

export type LocalRuntimeStartResult = {
  snapshot: LocalRuntimeSnapshot
  serverUrl: string
}

export type LocalServerSettings = {
  guildId: string
  channelId: string
  botTokensConfigured: boolean
  encryptionKeyConfigured: boolean
  databasePasswordConfigured: boolean
  dataDirectory: string
  defaultDataDirectory: string
  usingCustomDataDirectory: boolean
  dataDirectoryLocked: boolean
  backendPreferredPort: number
  postgresqlPreferredPort: number
  webPreferredPort: number
}

export type LocalServerSettingsInput = {
  guildId: string
  channelId: string
  botTokens?: string
  dataDirectory?: string
}

export function getLocalRuntimeSnapshot() {
  return invokeLocal<LocalRuntimeSnapshot>("get_local_runtime_snapshot")
}

export function prepareLocalRuntime() {
  return invokeLocal<LocalRuntimeSnapshot>("prepare_local_runtime")
}

export function getLocalServerSettings() {
  return invokeLocal<LocalServerSettings>("get_local_server_settings")
}

export function saveLocalServerSettings(settings: LocalServerSettingsInput) {
  return invokeLocal<LocalServerSettings>("save_local_server_settings", { settings })
}

export function startLocalPostgresql() {
  return invokeLocal<LocalRuntimeSnapshot>("start_local_postgresql")
}

export function startLocalRuntime() {
  return invokeLocal<LocalRuntimeStartResult>("start_local_runtime")
}

export function stopLocalRuntime() {
  return invokeLocal<LocalRuntimeSnapshot>("stop_local_runtime")
}

export function restartLocalRuntime() {
  return invokeLocal<LocalRuntimeStartResult>("restart_local_runtime")
}

export function stopLocalPostgresql() {
  return invokeLocal<LocalRuntimeSnapshot>("stop_local_postgresql")
}

async function invokeLocal<T>(command: string, args?: Record<string, unknown>) {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw nativeError(error)
  }
}
