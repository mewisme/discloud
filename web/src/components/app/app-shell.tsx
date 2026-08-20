"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { AppHeader } from "@/components/app/app-header"
import { AppSidebar } from "@/components/app/app-sidebar"
import { CurrentUserProvider } from "@/components/app/current-user-context"
import { type Workspace, WorkspaceProvider } from "@/components/app/workspace-context"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { UploadManager } from "@/components/uploads/upload-manager"
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
  return (
    <CurrentUserProvider user={user}>
      <WorkspaceProvider workspace={workspace}>
        <SidebarProvider defaultOpen={defaultSidebarOpen}>
          <Button
            asChild
            size="sm"
            variant="secondary"
            className="fixed left-3 top-3 z-50 -translate-y-20 shadow-lg transition-transform focus:translate-y-0"
          >
            <Link href="#main-content">Skip to content</Link>
          </Button>

          <AppSidebar
            user={user}
            workspace={workspace}
            usage={usage}
          />

          <SidebarInset>
            <AppHeader
              user={user}
              workspace={workspace}
            />

            <main
              id="main-content"
              tabIndex={-1}
              className="flex flex-1 flex-col p-4 outline-none sm:p-6"
            >
              {children}
            </main>
          </SidebarInset>

          <UploadManager />
        </SidebarProvider>
      </WorkspaceProvider>
    </CurrentUserProvider>
  )
}