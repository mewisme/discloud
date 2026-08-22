import type {
  ChangePasswordInput,
  LoginInput,
  LoginResult,
  SetupInput,
  SetupResult,
  User,
  VerifyLoginMFAInput,
} from "@discloud/api/models"
import { APIError } from "@discloud/api/types"

import { apiJSON } from "#lib/api/transport"

export function completeSetup(input: SetupInput) {
  return apiJSON<SetupResult>("/api/v1/setup", {
    method: "POST",
    body: input,
  })
}

export function login(input: LoginInput) {
  return apiJSON<LoginResult>("/api/v1/auth/login", {
    method: "POST",
    body: input,
  })
}

export function verifyMFA(input: VerifyLoginMFAInput) {
  return apiJSON<User>("/api/v1/auth/mfa/verify", {
    method: "POST",
    body: input,
  })
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    return await apiJSON<User>("/api/v1/auth/me")
  } catch (error) {
    if (error instanceof APIError && error.status === 401) return null

    throw error
  }
}

export async function changePassword(input: ChangePasswordInput) {
  await apiJSON<void>("/api/v1/me/password", {
    method: "PUT",
    body: input,
  })
}

export async function logout() {
  await apiJSON<void>("/api/v1/auth/logout", {
    method: "POST",
  })
}