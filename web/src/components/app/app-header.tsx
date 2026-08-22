"use client"

import { AppHeaderView } from "@discloud/app-ui/shell/app-header"
import { appRouteTitle } from "@discloud/shared/navigation"
import { usePathname } from "next/navigation"

import { CommandPalette } from "@/components/app/command-palette"
import { HeaderUserMenu } from "@/components/app/header-user-menu"
import { ModeToggle } from "@/components/app/mode-toggle"
import type { Workspace } from "@/components/app/workspace-context"
import type { User } from "@/lib/api/models"

export function AppHeader({
  user,
  workspace,
}: {
  user: User
  workspace: Workspace
}) {
  const pathname = usePathname()

  return (
    <AppHeaderView
      title={appRouteTitle(pathname, workspace.username)}
      center={<CommandPalette />}
      actions={
        <>
          <ModeToggle />
          <HeaderUserMenu user={user} />
        </>
      }
    />
  )
}