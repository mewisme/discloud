import { invoke } from "@tauri-apps/api/core"

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
    logsDir: string
  } | null
  manifest: LocalRuntimeManifest | null
  postgresql: PostgresqlRuntimeSnapshot | null
  error: string | null
}

export function getLocalRuntimeSnapshot() {
  return invoke<LocalRuntimeSnapshot>("get_local_runtime_snapshot")
}

export function prepareLocalRuntime() {
  return invoke<LocalRuntimeSnapshot>("prepare_local_runtime")
}

export function startLocalPostgresql() {
  return invoke<LocalRuntimeSnapshot>("start_local_postgresql")
}

export function stopLocalPostgresql() {
  return invoke<LocalRuntimeSnapshot>("stop_local_postgresql")
}
