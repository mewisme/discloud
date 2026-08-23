import { Channel, invoke } from "@tauri-apps/api/core"

import { nativeError } from "#lib/api/transport"

export type NativeUploadFile = {
  path: string
  name: string
  size: number
  relativePath: string
}

export type NativeUploadTransferEvent = {
  status: "uploading" | "finalizing"
  sessionId: string
  uploadedBytes: number
}

export type NativeUploadRunResult = {
  sessionId: string
  uploadedBytes: number
}

export type NativeUploadRunInput = {
  taskId: string
  uploadId?: string
  folderId: string
  path: string
  name: string
  size: number
}

export async function inspectNativeUploadFiles(paths: readonly string[]) {
  try {
    return await invoke<NativeUploadFile[]>("inspect_upload_files", { paths: [...paths] })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function beginNativeUploadTask(taskId: string) {
  try {
    await invoke<void>("begin_upload_task", { taskId })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function cancelNativeUploadTask(taskId: string, uploadId?: string) {
  try {
    return await invoke<boolean>("cancel_upload_task", { taskId, uploadId: uploadId ?? null })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function finishNativeUploadTask(taskId: string) {
  try {
    await invoke<void>("finish_upload_task", { taskId })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function runNativeUploadTask(input: NativeUploadRunInput, onProgress: (event: NativeUploadTransferEvent) => void) {
  const channel = new Channel<NativeUploadTransferEvent>()
  channel.onmessage = onProgress

  try {
    return await invoke<NativeUploadRunResult>("run_upload_task", {
      input: { ...input, uploadId: input.uploadId ?? null },
      onProgress: channel,
    })
  } catch (error) {
    throw nativeError(error)
  }
}
