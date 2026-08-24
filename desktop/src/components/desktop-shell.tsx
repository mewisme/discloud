import type { User } from "@discloud/api/models"
import { SettingsBreadcrumb } from "@discloud/app-ui/settings/settings-breadcrumb"
import { AppHeaderView } from "@discloud/app-ui/shell/app-header"
import { AppShellFrame } from "@discloud/app-ui/shell/app-shell"
import { type AppLinkRenderer, AppSidebarView } from "@discloud/app-ui/shell/app-sidebar"
import { createAppNavigation } from "@discloud/app-ui/shell/navigation"
import { appRouteTitle, workspacePath } from "@discloud/shared/navigation"
import { Button } from "@discloud/ui/components/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@discloud/ui/components/dropdown-menu"
import { ArrowUpDownIcon, ChevronDownIcon, DownloadIcon, LogOutIcon, RefreshCwIcon, ServerIcon, SettingsIcon, UserIcon } from "lucide-react"
import { useState } from "react"
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router"

import { useDesktopSession } from "#components/desktop-session"
import { errorMessage } from "#lib/instance"

import { DesktopAdminSurface } from "../features/admin/ui/admin-surface"
import { DesktopUserAvatar } from "../features/avatar/ui/user-avatar"
import { useDesktopUserConfig } from "../features/settings/ui/user-config-provider"
import { useDesktopSync } from "../features/sync/ui/sync-provider"
import { DesktopModeToggle } from "../features/theme/ui/mode-toggle"
import { useDesktopUpdater } from "../features/updater/ui/updater-provider"
import { DesktopWorkspaceSwitcher } from "../features/workspaces/ui/workspace-switcher"
import { DesktopCommandPalette } from "./command-palette"

const renderRouterLink: AppLinkRenderer = ({ href, children, onNavigate }) => <Link to={href} onClick={onNavigate}>{children}</Link>

export function DesktopAppLayout({ serverUrl, user }: { serverUrl: string; user: User }) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const { config } = useDesktopUserConfig()
  const workspaceUsername = params.username ?? user.username
  const sidebar = config?.common.sidebar
  const sidebarSide = sidebar?.side ?? "left"
  const baseNavigation = createAppNavigation({ actorUsername: user.username, workspaceUsername, isAdmin: user.role === "admin" })
  const uploadsPath = workspacePath(user.username, "uploads")
  const downloadsPath = workspacePath(user.username, "downloads")
  const syncPath = workspacePath(user.username, "sync")
  const transferItems = [...baseNavigation.primary.filter((item) => item.href === uploadsPath), { title: "Downloads", href: downloadsPath, icon: DownloadIcon }, { title: "Sync", href: syncPath, icon: RefreshCwIcon }]
  const navigation = { ...baseNavigation, primary: baseNavigation.primary.filter((item) => item.href !== uploadsPath) }
  const title = location.pathname === syncPath || location.pathname.startsWith(`${syncPath}/`) ? "Sync" : appRouteTitle(location.pathname, workspaceUsername)
  const settingsPage = desktopSettingsPage(location.pathname, user.username)
  const adminPath = workspacePath(user.username, "admin")
  const adminSurface = user.role === "admin" && workspaceUsername === user.username && (location.pathname === adminPath || location.pathname.startsWith(`${adminPath}/`))
    ? <DesktopAdminSurface pathname={location.pathname} username={user.username} />
    : null

  return (
    <AppShellFrame
      sidebarOnRight={sidebarSide === "right"}
      sidebar={
        <AppSidebarView
          side={sidebarSide}
          variant={sidebar?.variant ?? "sidebar"}
          collapsible={sidebar?.collapsible ?? "icon"}
          pathname={location.pathname}
          primaryItems={navigation.primary}
          workspaceGroups={[{ title: "Transfers", icon: ArrowUpDownIcon, items: transferItems }]}
          libraryItems={navigation.library}
          administrationItems={navigation.administration}
          header={<DesktopWorkspaceSwitcher currentUser={user} workspaceUsername={workspaceUsername} sidebarSide={sidebarSide} />}
          renderLink={renderRouterLink}
        />
      }
      header={
        <AppHeaderView
          title={title}
          center={<DesktopCommandPalette user={user} workspaceUsername={workspaceUsername} />}
          actions={<DesktopHeaderActions user={user} serverUrl={serverUrl} />}
        />
      }
    >
      {adminSurface ?? (settingsPage ? (
        <div className={`mx-auto w-full ${settingsPage.maxWidth} space-y-3`}>
          <SettingsBreadcrumb title={settingsPage.title} settingsHref={workspacePath(user.username, "settings")} onNavigate={(href) => navigate(href)} />
          <Outlet />
        </div>
      ) : <Outlet />)}
    </AppShellFrame>
  )
}

function DesktopHeaderActions({ user, serverUrl }: { user: User; serverUrl: string }) {
  const updater = useDesktopUpdater()
  const sync = useDesktopSync()
  const syncing = Object.values(sync.runtimes).some((runtime) => runtime.status === "syncing")
  const syncError = Object.values(sync.runtimes).some((runtime) => runtime.status === "error")

  return (
    <div className="flex items-center gap-1">
      <DesktopModeToggle />

      {sync.pairs.length > 0 ? (
        <Button asChild variant="ghost" size="sm">
          <Link to={workspacePath(user.username, "sync")} title={syncError ? "A sync pair needs attention" : syncing ? "Sync in progress" : "Folder sync"}>
            <RefreshCwIcon className={syncing ? "animate-spin" : syncError ? "text-destructive" : ""} />
            <span className="hidden sm:inline">Sync</span>
          </Link>
        </Button>
      ) : null}

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
        <Button type="button" variant="ghost" className="h-8 gap-2 rounded-lg px-1.5 sm:pr-2" disabled={busy} aria-label={`Open ${user.name} menu`}>
          <DesktopUserAvatar user={user} size="sm" />
          <span className="hidden max-w-32 truncate text-sm font-medium lg:inline">{user.name}</span>
          <ChevronDownIcon className="hidden size-3.5 text-muted-foreground lg:block" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-3 py-1">
            <DesktopUserAvatar user={user} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">@{user.username} · <span className="capitalize">{user.role}</span></p>
            </div>
          </div>
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

function desktopSettingsPage(pathname: string, username: string) {
  const pages = [
    { path: workspacePath(username, "settings/common"), title: "Common", maxWidth: "max-w-6xl" },
    { path: workspacePath(username, "settings/profile"), title: "Profile", maxWidth: "max-w-2xl" },
    { path: workspacePath(username, "settings/security"), title: "Security", maxWidth: "max-w-2xl" },
    { path: workspacePath(username, "settings/desktop"), title: "Desktop", maxWidth: "max-w-3xl" },
  ] as const

  return pages.find((page) => page.path === pathname)
}
