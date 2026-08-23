import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"

import { nativeError } from "#lib/api/transport"

export type NativeDownloadResult = {
  bytesWritten: number
}

export type NativeFile = {
  id: string
  name: string
}

export function nativeFileContentURL(fileId: string, collectionId?: string) {
  const resource = collectionId
    ? `collections/${collectionId}/files/${fileId}`
    : `files/${fileId}`

  return convertFileSrc(resource, "discloud").replace(/%2F/gi, "/")
}

export async function downloadNativeFile(file: NativeFile, collectionId?: string) {
  try {
    const destination = await save({ title: `Save ${file.name}`, defaultPath: safeDownloadName(file.name) })
    if (!destination) return undefined

    return await invoke<NativeDownloadResult>("download_file", {
      fileId: file.id,
      collectionId,
      destination,
    })
  } catch (error) {
    throw nativeError(error)
  }
}

function safeDownloadName(name: string) {
  // eslint-disable-next-line no-control-regex
  const sanitized = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").trim()
  return !sanitized || sanitized === "." || sanitized === ".." ? "download" : sanitized
}