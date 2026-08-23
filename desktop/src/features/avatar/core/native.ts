import { invoke } from "@tauri-apps/api/core"

import { nativeError } from "#lib/api/transport"

export type NativeAvatarPayload = {
  contentType: string
  bytes: number[]
}

export async function loadNativeAvatar(userId?: string) {
  try {
    return await invoke<NativeAvatarPayload | null>("load_avatar", userId ? { userId } : {})
  } catch (error) {
    throw nativeError(error)
  }
}