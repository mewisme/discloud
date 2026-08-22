import type { Metadata } from "next"

import { CommonSettings } from "@/components/settings/common-settings"
import { SettingsPageHeader } from "@/components/settings/settings-page-header"
import { SettingsSectionNav, type SettingsSectionNavItem } from "@/components/settings/settings-section-nav"

export const metadata: Metadata = {
  title: "Common",
}

const sections = [
  { id: "theme", title: "Theme" },
  { id: "sidebar", title: "Sidebar" },
  { id: "file-browser", title: "File browser" },
  { id: "pagination", title: "Pagination" },
  { id: "file-preview", title: "File preview" },
  { id: "date-time", title: "Date & time" },
] satisfies SettingsSectionNavItem[]

export default function CommonSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SettingsPageHeader
        title="Common"
        description="Customize the general appearance and behavior of your DisCloud workspace."
      />

      <div className="grid min-w-0 gap-8 lg:grid-cols-[10rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <SettingsSectionNav
            items={sections}
            className="sticky top-20"
          />
        </aside>

        <CommonSettings />
      </div>
    </div>
  )
}