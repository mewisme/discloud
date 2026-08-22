import type { UpdateCommonConfigInput, UserConfig } from "@discloud/api/models"

import { apiJSON } from "#lib/api/transport"

export function loadUserConfig() {
  return apiJSON<UserConfig>("/api/v1/me/config")
}

export function updateCommonConfig(input: UpdateCommonConfigInput) {
  return apiJSON<UserConfig>("/api/v1/me/config/common", {
    method: "PUT",
    body: input,
  })
}
