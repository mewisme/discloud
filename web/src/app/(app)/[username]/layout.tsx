import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"
import type { ReactNode } from "react"

import { AppShell } from "@/components/app/app-shell"
import { WorkspaceAccessDenied } from "@/components/app/workspace-access-denied"
import { getCurrentUser } from "@/lib/auth/session"
import { getWorkspace, WorkspaceAccessError, WorkspaceNotFoundError } from "@/lib/workspace/server"

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ username: string }>
}) {
  const [{ username }, currentUser] = await Promise.all([params, getCurrentUser()])

  if (!currentUser) redirect("/login")

  let workspace

  try {
    workspace = await getWorkspace(username)
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return (
        <WorkspaceAccessDenied
          username={username}
          currentUsername={currentUser.username}
        />
      )
    }
    if (error instanceof WorkspaceNotFoundError) notFound()
    throw error
  }

  const cookieStore = await cookies()
  const defaultSidebarOpen = cookieStore.get("sidebar_state")?.value !== "false"

  return (
    <AppShell
      user={currentUser}
      workspace={workspace.owner}
      usage={workspace.usage}
      defaultSidebarOpen={defaultSidebarOpen}
    >
      {children}
    </AppShell>
  )
}