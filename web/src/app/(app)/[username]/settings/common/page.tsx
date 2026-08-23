import type { Metadata } from "next"

import { CommonSettings } from "@/components/settings/common-settings"
import { SettingsPageHeader } from "@/components/settings/settings-page-header"

export const metadata: Metadata = {
  title: "Common",
}

export default function CommonSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SettingsPageHeader title="Common" description="Customize the general appearance and behavior of your DisCloud workspace." />
      <CommonSettings />
    </div>
  )
}
