import type { Metadata } from "next"
import { CommonSettings } from "@/components/settings/common-settings"

export const metadata: Metadata = {
  title: "Common",
}

export default function CommonSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Common</h1>
        <p className="text-sm text-muted-foreground">Manage general display preferences for your DisCloud account.</p>
      </div>

      <CommonSettings />
    </div>
  )
}