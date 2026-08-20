"use client"

import { usePathname } from "next/navigation"

import { CommandPalette } from "@/components/app/command-palette"
import { HeaderUserMenu } from "@/components/app/header-user-menu"
import { ModeToggle } from "@/components/app/mode-toggle"
import type { Workspace } from "@/components/app/workspace-context"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import type { User } from "@/lib/api/models"
import { workspaceRelativePath } from "@/lib/workspace/navigation"

export function AppHeader({
  user,
  workspace,
}: {
  user: User
  workspace: Workspace
}) {
  const pathname = usePathname()
  const title = routeTitle(pathname, workspace.username)

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/75">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-8" />

        <span className="hidden max-w-40 truncate text-sm font-medium sm:inline lg:max-w-64">
          {title}
        </span>
      </div>

      <div className="pointer-events-none fixed left-1/2 top-2 z-30 w-[calc(100vw-10rem)] max-w-md -translate-x-1/2 sm:w-[min(28rem,calc(100vw-18rem))] lg:w-[min(32rem,calc(100vw-24rem))]">
        <div className="pointer-events-auto">
          <CommandPalette />
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ModeToggle />
        <HeaderUserMenu user={user} />
      </div>
    </header>
  )
}

function routeTitle(pathname: string, username: string) {
  const path = workspaceRelativePath(pathname, username)

  if (!path) return "DisCloud"
  if (path === "/" || path.startsWith("/folders/")) return "Files"
  if (path.startsWith("/files/")) return "File"
  if (path.startsWith("/uploads")) return "Uploads"
  if (path.startsWith("/admin/diagnostics")) return "Diagnostics"
  if (path === "/admin" || path.startsWith("/admin/")) return "Admin"
  if (path.startsWith("/settings/profile")) return "Profile"
  if (path.startsWith("/settings/security")) return "Security"
  if (path.startsWith("/settings/common")) return "Common"
  if (path === "/settings" || path.startsWith("/settings/")) return "Settings"
  if (path.startsWith("/collections")) return "Collections"
  if (path.startsWith("/favorites")) return "Favorites"
  if (path.startsWith("/shared")) return "Shared"
  if (path.startsWith("/search")) return "Search"
  if (path.startsWith("/trash")) return "Trash"

  return "DisCloud"
}