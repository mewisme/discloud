import type { Metadata } from "next"
import { CommonSettings } from "@/components/settings/common-settings"
import { SettingsPageHeader } from "@/components/settings/settings-page-header"

export const metadata: Metadata = {
  title: "Common",
}

export default function CommonSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <SettingsPageHeader
        title="Common"
        description="Manage general display preferences for your DisCloud account."
      />

      <CommonSettings />
    </div>
  )
}