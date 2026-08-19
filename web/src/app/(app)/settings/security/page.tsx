import type { Metadata } from "next"
import { SecuritySettings } from "@/components/settings/security-settings"
import { apiServerAuthJSON } from "@/lib/api/server"
import type { MFAStatus } from "@/lib/api/models"

export const metadata: Metadata = {
  title: "Security",
}

export default async function SecurityPage() {
  const status = await apiServerAuthJSON<MFAStatus>("/api/v1/me/mfa")

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-sm text-muted-foreground">Manage two-factor authentication and recovery codes.</p>
      </div>
      <SecuritySettings initialEnabled={status.enabled} />
    </div>
  )
}