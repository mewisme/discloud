"use client"

import { SettingsBreadcrumb } from "@discloud/app-ui/settings/settings-breadcrumb"
import { useRouter } from "next/navigation"

import { useCurrentUser } from "@/components/app/current-user-context"
import { workspacePath } from "@/lib/workspace/navigation"

export function SettingsPageHeader({ title, description }: { title: string; description: string }) {
  const router = useRouter()
  const user = useCurrentUser()

  return (
    <div className="space-y-3">
      <SettingsBreadcrumb title={title} settingsHref={workspacePath(user.username, "settings")} onNavigate={(href) => router.push(href)} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
