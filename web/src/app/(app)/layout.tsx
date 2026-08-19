import type { ReactNode } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { AppShell } from "@/components/app/app-shell"
import { apiServerAuthJSON } from "@/lib/api/server"
import type { CurrentUserUsage } from "@/lib/api/models"
import { getCurrentUser } from "@/lib/auth/session"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser()

  if (!user) redirect("/login")
  if (user.mustChangePassword) redirect("/change-password")

  const [usage, cookieStore] = await Promise.all([
    apiServerAuthJSON<CurrentUserUsage>("/api/v1/me/usage"),
    cookies(),
  ])

  return (
    <AppShell user={user} usage={usage} defaultSidebarOpen={cookieStore.get("sidebar_state")?.value !== "false"}>
      {children}
    </AppShell>
  )
}