import { invoke } from "@tauri-apps/api/core"

import { nativeError } from "#lib/api/transport"

export type NativeUploadFile = {
  path: string
  name: string
  size: number
  relativePath: string
}

export type NativeUploadPartResult = {
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

export async function cancelNativeUploadTask(taskId: string) {
  try {
    return await invoke<boolean>("cancel_upload_task", { taskId })
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

export async function uploadNativePart(input: {
  taskId: string
  uploadId: string
  path: string
  partIndex: number
  offset: number
  size: number
}) {
  try {
    return await invoke<NativeUploadPartResult>("upload_file_part", input)
  } catch (error) {
    throw nativeError(error)
  }
}