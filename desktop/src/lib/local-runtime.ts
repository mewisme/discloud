import { invoke } from "@tauri-apps/api/core"

import { nativeError } from "#lib/api/transport"

export type LocalRuntimeStatus = "disabled" | "preparing" | "installing" | "stopped" | "downloading" | "initializingDatabase" | "startingDatabase" | "databaseReady" | "startingBackend" | "startingWeb" | "ready" | "degraded" | "failed" | "stopping"
export type LocalRuntimeLogStage = "prepare" | "postgresqlRuntime" | "database" | "backend" | "web" | "connect"

export type LocalRuntimeLog = {
  content: string
  truncated: boolean
}

export type LocalDataCompatibility = {
  schemaVersion: number
  supportedSchemaMin: number
  supportedSchemaMax: number
  compatible: boolean
  lastAppVersion: string | null
  detail: string | null
}

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

export type WebRuntimeSnapshot = {
  enabled: boolean
  installed: boolean
  desiredInstalled: boolean
  running: boolean
  version: string | null
  desiredVersion: string
  previousVersion: string | null
  port: number | null
  url: string | null
  error: string | null
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
    dataMetadataPath: string
    postgresqlStatePath: string
    backendStatePath: string
    backendShutdownPath: string
    webStatePath: string
    webShutdownPath: string
    logsDir: string
  } | null
  manifest: LocalRuntimeManifest | null
  postgresql: PostgresqlRuntimeSnapshot | null
  backend: BackendRuntimeSnapshot | null
  web: WebRuntimeSnapshot | null
  error: string | null
}

export type LocalRuntimeStartResult = {
  snapshot: LocalRuntimeSnapshot
  serverUrl: string
}

export type LocalDatabaseExportResult = {
  path: string
  bytes: number
}

export type LocalServerSettings = {
  guildId: string
  channelId: string
  botTokensConfigured: boolean
  botTokenCount: number
  encryptionKeyConfigured: boolean
  databasePasswordConfigured: boolean
  dataDirectory: string
  defaultDataDirectory: string
  usingCustomDataDirectory: boolean
  dataDirectoryLocked: boolean
  backendPreferredPort: number
  postgresqlPreferredPort: number
  webPreferredPort: number
  webEnabled: boolean
  dataCompatibility: LocalDataCompatibility
}

export type LocalServerSettingsInput = {
  guildId: string
  channelId: string
  botTokens?: string
  dataDirectory?: string
  webEnabled?: boolean
}

export function getLocalRuntimeSnapshot() {
  return invokeLocal<LocalRuntimeSnapshot>("get_local_runtime_snapshot")
}

export function getLocalRuntimeLog(stage: LocalRuntimeLogStage) {
  return invokeLocal<LocalRuntimeLog>("get_local_runtime_log", { stage })
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

export function exportLocalDatabase(destination: string) {
  return invokeLocal<LocalDatabaseExportResult>("export_local_database", { destination })
}

export function importLocalDatabase(source: string) {
  return invokeLocal<LocalRuntimeSnapshot>("import_local_database", { source })
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
