import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import { nativeError } from "#lib/api/transport"

const uploadSnapshotEvent = "discloud-upload-snapshot"
const uploadTaskEvent = "discloud-upload-task"
const uploadRemovedEvent = "discloud-upload-removed"
const uploadFolderChangedEvent = "discloud-upload-folder-changed"
const uploadUnauthorizedEvent = "discloud-upload-unauthorized"

export type NativeUploadFile = {
  name: string
  size: number
}

export type NativeUploadTaskStatus = "queued" | "preparing" | "uploading" | "finalizing" | "completed" | "skipped" | "error" | "cancelling" | "cancelled"

export type NativeUploadTask = {
  id: string
  file: NativeUploadFile
  folderId: string
  relativePath?: string
  status: NativeUploadTaskStatus
  uploadedBytes: number
  error?: string
  canCancel: boolean
  canRemove: boolean
}

export type NativeUploadSnapshot = {
  tasks: NativeUploadTask[]
  completionVersion: number
  revision: number
}

export type NativeUploadTaskEvent = {
  task: NativeUploadTask
  completionVersion: number
  revision: number
}

export type NativeUploadRemovedEvent = {
  taskId: string
  completionVersion: number
  revision: number
}

export type NativeUploadFolderChangedEvent = {
  folderId: string
}

type NativeUploadEventHandlers = {
  onSnapshot: (snapshot: NativeUploadSnapshot) => void
  onTask: (event: NativeUploadTaskEvent) => void
  onRemoved: (event: NativeUploadRemovedEvent) => void
  onFolderChanged: (event: NativeUploadFolderChangedEvent) => void
  onUnauthorized: () => void
}

export async function getNativeUploadSnapshot() {
  try {
    return await invoke<NativeUploadSnapshot>("get_upload_snapshot")
  } catch (error) {
    throw nativeError(error)
  }
}

export async function addNativeUploadPaths(folderId: string, paths: readonly string[]) {
  try {
    await invoke<void>("add_upload_paths", { folderId, paths: [...paths] })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function retryNativeUploadTask(taskId: string) {
  try {
    await invoke<void>("retry_upload_task", { taskId })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function cancelNativeUploadTask(taskId: string) {
  try {
    await invoke<void>("cancel_upload_task", { taskId })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function removeNativeUploadTask(taskId: string) {
  try {
    await invoke<void>("remove_upload_task", { taskId })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function subscribeNativeUploads(handlers: NativeUploadEventHandlers) {
  const unlisteners: UnlistenFn[] = []

  try {
    unlisteners.push(
      await listen<NativeUploadSnapshot>(uploadSnapshotEvent, (event) => handlers.onSnapshot(event.payload)),
      await listen<NativeUploadTaskEvent>(uploadTaskEvent, (event) => handlers.onTask(event.payload)),
      await listen<NativeUploadRemovedEvent>(uploadRemovedEvent, (event) => handlers.onRemoved(event.payload)),
      await listen<NativeUploadFolderChangedEvent>(uploadFolderChangedEvent, (event) => handlers.onFolderChanged(event.payload)),
      await listen(uploadUnauthorizedEvent, () => handlers.onUnauthorized()),
    )

    handlers.onSnapshot(await getNativeUploadSnapshot())
  } catch (error) {
    unlisteners.forEach((unlisten) => unlisten())
    throw nativeError(error)
  }

  return () => unlisteners.forEach((unlisten) => unlisten())
}
