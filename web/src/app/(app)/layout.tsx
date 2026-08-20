import { redirect } from "next/navigation"
import type { ReactNode } from "react"

import { UserConfigProvider } from "@/components/settings/user-config-context"
import { UploadProvider } from "@/components/uploads/upload-provider"
import type { UserConfig } from "@/lib/api/models"
import { apiServerAuthJSON } from "@/lib/api/server"
import { getCurrentUser } from "@/lib/auth/session"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser()

  if (!user) redirect("/login")
  if (user.mustChangePassword) redirect("/change-password")

  const config = await apiServerAuthJSON<UserConfig>("/me/config")

  return (
    <UserConfigProvider initialConfig={config}>
      <UploadProvider>
        {children}
      </UploadProvider>
    </UserConfigProvider>
  )
}