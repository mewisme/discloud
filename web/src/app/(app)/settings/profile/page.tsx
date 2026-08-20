import type { Metadata } from "next"
import { ProfileSettings } from "@/components/settings/profile-settings"

export const metadata: Metadata = {
  title: "Profile",
}

export default function ProfileSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage your DisCloud profile and account identity.</p>
      </div>

      <ProfileSettings />
    </div>
  )
}