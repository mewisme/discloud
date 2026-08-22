import type { User } from "@discloud/api/models"
import { AppHeaderView } from "@discloud/app-ui/shell/app-header"
import { AppShellFrame } from "@discloud/app-ui/shell/app-shell"
import { type AppLinkRenderer, AppSidebarView } from "@discloud/app-ui/shell/app-sidebar"
import { createAppNavigation } from "@discloud/app-ui/shell/navigation"
import { appRouteTitle, workspacePath } from "@discloud/shared/navigation"
import { Button } from "@discloud/ui/components/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@discloud/ui/components/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@discloud/ui/components/sidebar"
import { CloudIcon, DownloadIcon, LogOutIcon, ServerIcon, SettingsIcon, UserIcon } from "lucide-react"
import { useState } from "react"
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router"

import { useDesktopSession } from "#components/desktop-session"
import { errorMessage } from "#lib/instance"

import { DesktopAdminSurface } from "../features/admin/ui/admin-surface"
import { useDesktopUserConfig } from "../features/settings/ui/user-config-provider"
import { useDesktopUpdater } from "../features/updater/ui/updater-provider"

const renderRouterLink: AppLinkRenderer = ({ href, children, onNavigate }) => <Link to={href} onClick={onNavigate}>{children}</Link>

export function DesktopAppLayout({ serverUrl, user }: { serverUrl: string; user: User }) {
  const location = useLocation()
  const params = useParams()
  const { config } = useDesktopUserConfig()
  const workspaceUsername = params.username ?? user.username
  const sidebar = config?.common.sidebar
  const navigation = createAppNavigation({ actorUsername: user.username, workspaceUsername, isAdmin: user.role === "admin" })
  const adminSurface = user.role === "admin" && workspaceUsername === user.username
    ? <DesktopAdminSurface pathname={location.pathname} username={user.username} />
    : null

  return (
    <AppShellFrame
      sidebarOnRight={sidebar?.side === "right"}
      sidebar={
        <AppSidebarView
          side={sidebar?.side ?? "left"}
          variant={sidebar?.variant ?? "inset"}
          collapsible={sidebar?.collapsible ?? "icon"}
          pathname={location.pathname}
          primaryItems={navigation.primary}
          libraryItems={navigation.library}
          administrationItems={navigation.administration}
          header={<WorkspaceIdentity username={workspaceUsername} />}
          renderLink={renderRouterLink}
        />
      }
      header={<AppHeaderView title={appRouteTitle(location.pathname, workspaceUsername)} actions={<DesktopHeaderActions user={user} serverUrl={serverUrl} />} />}
    >
      {adminSurface ?? <Outlet />}
    </AppShellFrame>
  )
}

function WorkspaceIdentity({ username }: { username: string }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={`@${username}`}>
          <CloudIcon />
          <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">DisCloud</span>
            <span className="truncate text-xs text-muted-foreground">@{username}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function DesktopHeaderActions({ user, serverUrl }: { user: User; serverUrl: string }) {
  const updater = useDesktopUpdater()

  return (
    <div className="flex items-center gap-1">
      {updater.update && updater.stage !== "error" ? (
        <Button asChild variant="ghost" size="sm">
          <Link to={workspacePath(user.username, "settings/desktop")}>
            <DownloadIcon />
            <span className="hidden sm:inline">v{updater.update.version}</span>
          </Link>
        </Button>
      ) : null}
      <DesktopUserMenu user={user} serverUrl={serverUrl} />
    </div>
  )
}

function DesktopUserMenu({ user, serverUrl }: { user: User; serverUrl: string }) {
  const navigate = useNavigate()
  const { changeServer, signOut } = useDesktopSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function perform(action: () => Promise<void>, destination: string) {
    if (busy) return

    setBusy(true)
    setError(undefined)

    try {
      await action()
      navigate(destination, { replace: true })
    } catch (error) {
      setError(errorMessage(error))
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={busy}>
          <UserIcon />
          <span className="hidden max-w-32 truncate sm:inline">{user.name}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="truncate">{user.name}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">@{user.username}</div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link to={workspacePath(user.username, "settings/profile")}><UserIcon />Profile</Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link to={workspacePath(user.username, "settings")}><SettingsIcon />Settings</Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{serverUrl}</DropdownMenuLabel>

        <DropdownMenuItem disabled={busy} onClick={() => void perform(changeServer, "/connect")}><ServerIcon />Change server</DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onClick={() => void perform(signOut, "/login")}><LogOutIcon />Sign out</DropdownMenuItem>

        {error ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="whitespace-normal text-xs font-normal text-destructive">{error}</DropdownMenuLabel>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
