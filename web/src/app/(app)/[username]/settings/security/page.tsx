import type { Metadata } from "next"

import { SecuritySettings } from "@/components/settings/security-settings"
import { SettingsPageHeader } from "@/components/settings/settings-page-header"
import type { MFAStatus } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"

export const metadata: Metadata = {
  title: "Security",
}

export default async function SecurityPage() {
  const status = await apiServerAuthJSON<MFAStatus>("/api/v1/me/mfa")

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <SettingsPageHeader
        title="Security"
        description="Manage two-factor authentication and recovery codes."
      />

      <SecuritySettings initialEnabled={status.enabled} />
    </div>
  )
}