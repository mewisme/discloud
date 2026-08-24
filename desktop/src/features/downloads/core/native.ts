import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import { nativeError } from "#lib/api/transport"

const downloadSnapshotEvent = "discloud-download-snapshot"
const downloadTaskEvent = "discloud-download-task"
const downloadRemovedEvent = "discloud-download-removed"

export type NativeDownloadTaskStatus = "queued" | "downloading" | "completed" | "error" | "cancelling" | "cancelled"

export type NativeDownloadTask = {
  id: string
  fileName: string
  status: NativeDownloadTaskStatus
  downloadedBytes: number
  totalBytes?: number
  bytesPerSecond?: number
  etaSeconds?: number
  error?: string
  startedAt?: number
  finishedAt?: number
  canCancel: boolean
  canRetry: boolean
  canRemove: boolean
  canReveal: boolean
}

export type NativeDownloadSnapshot = {
  tasks: NativeDownloadTask[]
  revision: number
}

export type NativeDownloadTaskEvent = {
  task: NativeDownloadTask
  revision: number
}

export type NativeDownloadRemovedEvent = {
  taskId: string
  revision: number
}

type NativeDownloadEventHandlers = {
  onSnapshot: (snapshot: NativeDownloadSnapshot) => void
  onTask: (event: NativeDownloadTaskEvent) => void
  onRemoved: (event: NativeDownloadRemovedEvent) => void
}

export async function getNativeDownloadSnapshot() {
  try {
    return await invoke<NativeDownloadSnapshot>("get_download_snapshot")
  } catch (error) {
    throw nativeError(error)
  }
}

export async function startNativeDownload(input: { fileId: string; collectionId?: string; fileName: string; destination: string }) {
  try {
    return await invoke<NativeDownloadTask>("start_download", input)
  } catch (error) {
    throw nativeError(error)
  }
}

export async function retryNativeDownloadTask(taskId: string) {
  try {
    await invoke<void>("retry_download_task", { taskId })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function cancelNativeDownloadTask(taskId: string) {
  try {
    await invoke<void>("cancel_download_task", { taskId })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function removeNativeDownloadTask(taskId: string) {
  try {
    await invoke<void>("remove_download_task", { taskId })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function revealNativeDownloadTask(taskId: string) {
  try {
    await invoke<void>("reveal_download_task", { taskId })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function subscribeNativeDownloads(handlers: NativeDownloadEventHandlers) {
  const unlisteners: UnlistenFn[] = []

  try {
    unlisteners.push(
      await listen<NativeDownloadSnapshot>(downloadSnapshotEvent, (event) => handlers.onSnapshot(event.payload)),
      await listen<NativeDownloadTaskEvent>(downloadTaskEvent, (event) => handlers.onTask(event.payload)),
      await listen<NativeDownloadRemovedEvent>(downloadRemovedEvent, (event) => handlers.onRemoved(event.payload)),
    )
    handlers.onSnapshot(await getNativeDownloadSnapshot())
  } catch (error) {
    unlisteners.forEach((unlisten) => unlisten())
    throw nativeError(error)
  }

  return () => unlisteners.forEach((unlisten) => unlisten())
}
