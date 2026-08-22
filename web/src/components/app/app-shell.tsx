"use client"

import { AppShellFrame } from "@discloud/app-ui/shell/app-shell"
import type { ReactNode } from "react"

import { AppHeader } from "@/components/app/app-header"
import { AppSidebar } from "@/components/app/app-sidebar"
import { CurrentUserProvider } from "@/components/app/current-user-context"
import {
  type Workspace,
  WorkspaceProvider,
} from "@/components/app/workspace-context"
import { useUserConfigSelector } from "@/components/settings/user-config-context"
import type { CurrentUserUsage, User } from "@/lib/api/models"

export function AppShell({
  children,
  user,
  workspace,
  usage,
  defaultSidebarOpen,
}: {
  children: ReactNode
  user: User
  workspace: Workspace
  usage: CurrentUserUsage
  defaultSidebarOpen: boolean
}) {
  const sidebarSide = useUserConfigSelector(
    (config) => config.common.sidebar.side,
  )

  return (
    <CurrentUserProvider user={user}>
      <WorkspaceProvider workspace={workspace}>
        <AppShellFrame
          defaultSidebarOpen={defaultSidebarOpen}
          sidebarOnRight={sidebarSide === "right"}
          sidebar={
            <AppSidebar
              user={user}
              workspace={workspace}
              usage={usage}
            />
          }
          header={
            <AppHeader
              user={user}
              workspace={workspace}
            />
          }
        >
          {children}
        </AppShellFrame>
      </WorkspaceProvider>
    </CurrentUserProvider>
  )
}