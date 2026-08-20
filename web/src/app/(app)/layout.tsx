import type { ReactNode } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { AppShell } from "@/components/app/app-shell"
import { UploadManager } from "@/components/uploads/upload-manager"
import { UploadProvider } from "@/components/uploads/upload-provider"
import { apiServerAuthJSON } from "@/lib/api/server"
import { UserConfigProvider } from "@/components/settings/user-config-context"
import type { CurrentUserUsage, UserConfig } from "@/lib/api/models"
import { getCurrentUser } from "@/lib/auth/session"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser()

  if (!user) redirect("/login")
  if (user.mustChangePassword) redirect("/change-password")

  const [usage, userConfig, cookieStore] = await Promise.all([
    apiServerAuthJSON<CurrentUserUsage>("/api/v1/me/usage"),
    apiServerAuthJSON<UserConfig>("/api/v1/me/config"),
    cookies(),
  ])

  return (
    <UserConfigProvider initialConfig={userConfig}>
      <UploadProvider>
        <AppShell user={user} usage={usage} defaultSidebarOpen={cookieStore.get("sidebar_state")?.value !== "false"}>
          {children}
        </AppShell>
        <UploadManager />
      </UploadProvider>
    </UserConfigProvider>
  )
}