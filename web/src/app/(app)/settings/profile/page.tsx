import type { Metadata } from "next"
import { ProfileSettings } from "@/components/settings/profile-settings"
import { SettingsPageHeader } from "@/components/settings/settings-page-header"

export const metadata: Metadata = {
  title: "Profile",
}

export default function ProfileSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <SettingsPageHeader
        title="Profile"
        description="Manage your DisCloud profile and account identity."
      />

      <ProfileSettings />
    </div>
  )
}