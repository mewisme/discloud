import type { ChangePasswordInput, MFACodeInput, MFAEnrollment, MFAStatus, RecoveryCodes } from "@discloud/api/models"

import { apiJSON } from "#lib/api/transport"

export function loadMFAStatus() {
  return apiJSON<MFAStatus>("/api/v1/me/mfa")
}

export function beginMFAEnrollment() {
  return apiJSON<MFAEnrollment>("/api/v1/me/mfa/totp/enroll", { method: "POST" })
}

export function confirmMFAEnrollment(input: MFACodeInput) {
  return apiJSON<RecoveryCodes>("/api/v1/me/mfa/totp/confirm", { method: "POST", body: input })
}

export function regenerateRecoveryCodes(input: MFACodeInput) {
  return apiJSON<RecoveryCodes>("/api/v1/me/mfa/recovery-codes/regenerate", { method: "POST", body: input })
}

export function disableMFA(input: MFACodeInput) {
  return apiJSON<void>("/api/v1/me/mfa/totp", { method: "DELETE", body: input })
}

export function updatePassword(input: ChangePasswordInput) {
  return apiJSON<void>("/api/v1/me/password", { method: "PUT", body: input })
}
