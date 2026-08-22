import type { File } from "@discloud/api/models"
import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"

import { nativeError } from "#lib/api/transport"

export type NativeDownloadResult = {
  bytesWritten: number
}

export function nativeFileContentURL(fileId: string) {
  return convertFileSrc(`files/${fileId}`, "discloud")
}

export async function downloadNativeFile(file: Pick<File, "id" | "name">) {
  try {
    const destination = await save({ title: `Save ${file.name}`, defaultPath: safeDownloadName(file.name) })
    if (!destination) return undefined
    return await invoke<NativeDownloadResult>("download_file", { fileId: file.id, destination })
  } catch (error) {
    throw nativeError(error)
  }
}

function safeDownloadName(name: string) {
  // eslint-disable-next-line no-control-regex
  const sanitized = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").trim()
  return !sanitized || sanitized === "." || sanitized === ".." ? "download" : sanitized
}