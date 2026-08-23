export type SyncDirection = "two-way" | "download-only" | "upload-only"
export type SyncDeletePolicy = "preserve" | "propagate"
export type SyncPairStatus = "idle" | "syncing" | "error"

export type SyncPair = {
  id: string
  serverUrl: string
  username: string
  localPath: string
  remoteFolderId: string
  remoteFolderName: string
  enabled: boolean
  direction: SyncDirection
  deletePolicy: SyncDeletePolicy
  intervalSeconds: number
  ignorePatterns: string[]
  createdAt: number
}

export type SyncRunResult = {
  uploaded: number
  downloaded: number
  remoteDeleted: number
  localDeleted: number
  conflicts: number
  createdRemoteFolders: number
  createdLocalFolders: number
  skipped: number
}

export type SyncPairRuntime = {
  status: SyncPairStatus
  lastStartedAt?: number
  lastFinishedAt?: number
  nextRunAt?: number
  lastResult?: SyncRunResult
  error?: string
}

export const syncIntervalOptions = [15, 30, 60, 300, 900] as const

export const defaultSyncIgnorePatterns = [
  ".git/",
  "node_modules/",
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "~$*",
  "*.tmp",
]
