import type { AvatarInfo, UpdateMeInput, User } from "@discloud/api/models"
import { invoke } from "@tauri-apps/api/core"

import { apiJSON, nativeError } from "#lib/api/transport"

export type NativeAvatarPayload = {
  contentType: string
  bytes: number[]
}

export function updateProfile(input: UpdateMeInput) {
  return apiJSON<User>("/api/v1/me", { method: "PATCH", body: input })
}

export async function updateNativeAvatar(path: string) {
  try {
    return await invoke<AvatarInfo>("update_avatar", { path })
  } catch (error) {
    throw nativeError(error)
  }
}

export async function loadNativeAvatar() {
  try {
    return await invoke<NativeAvatarPayload | null>("load_avatar")
  } catch (error) {
    throw nativeError(error)
  }
}

export function removeAvatar() {
  return apiJSON<void>("/api/v1/me/avatar", { method: "DELETE" })
}

export async function saveRecoveryCodes(destination: string, codes: readonly string[]) {
  try {
    await invoke<void>("save_recovery_codes", { destination, codes: [...codes] })
  } catch (error) {
    throw nativeError(error)
  }
}
