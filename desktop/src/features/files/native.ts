import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import { open, save } from "@tauri-apps/plugin-dialog"

import { nativeError } from "#lib/api/transport"

import { startNativeDownload } from "../downloads/core/native"

export type NativeFile = {
  id: string
  name: string
}

export function nativeFileContentURL(fileId: string, collectionId?: string) {
  const resource = collectionId
    ? `collections/${collectionId}/files/${fileId}`
    : `files/${fileId}`

  return convertFileSrc(resource, "discloud")
}

export async function downloadNativeFolder(folder: NativeFile) {
  try {
    const destination = await open({ title: `Download ${folder.name} to`, directory: true, multiple: false, recursive: true })
    if (!destination) return undefined
    await invoke("download_folder", { folderId: folder.id, destination })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function downloadNativeFileVersion(file: NativeFile, versionId: string) {
  try {
    const destination = await save({ title: `Save revision of ${file.name}`, defaultPath: safeDownloadName(file.name) })
    if (!destination) return undefined
    return await invoke("download_file", { fileId: file.id, collectionId: null, versionId, destination })
  } catch (error) { throw nativeError(error) }
}

export async function downloadNativeFile(file: NativeFile, collectionId?: string) {
  try {
    const destination = await save({ title: `Save ${file.name}`, defaultPath: safeDownloadName(file.name) })
    if (!destination) return undefined

    return await startNativeDownload({ fileId: file.id, collectionId, fileName: file.name, destination })
  } catch (error) {
    throw nativeError(error)
  }
}

function safeDownloadName(name: string) {
  // eslint-disable-next-line no-control-regex
  const sanitized = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").trim()
  return !sanitized || sanitized === "." || sanitized === ".." ? "download" : sanitized
}