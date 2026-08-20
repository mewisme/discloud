"use client"

import { ActivityIcon, CloudIcon, FolderIcon, HeartIcon, LibraryIcon, SearchIcon, Share2Icon, ShieldIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ComponentType, ReactNode } from "react"

import { CommandPalette } from "@/components/app/command-palette"
import { CurrentUserProvider } from "@/components/app/current-user-context"
import { HeaderUserMenu } from "@/components/app/header-user-menu"
import { ModeToggle } from "@/components/app/mode-toggle"
import { type Workspace, WorkspaceProvider } from "@/components/app/workspace-context"
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { UploadManager } from "@/components/uploads/upload-manager"
import type { CurrentUserUsage, User } from "@/lib/api/models"
import { formatBytes, isActivePath } from "@/lib/helpers"
import { workspacePath, workspaceRelativePath } from "@/lib/workspace/navigation"

type NavItem = {
  title: string
  href: string
  icon: ComponentType<{ className?: string }>
  enabled: boolean
  exact?: boolean
}

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
          <Button asChild size="sm" variant="secondary" className="fixed left-3 top-3 z-50 -translate-y-20 shadow-lg transition-transform focus:translate-y-0">
            <Link href="#main-content">Skip to content</Link>
          </Button>

          <AppSidebar user={user} workspace={workspace} usage={usage} />

          <SidebarInset>
            <AppHeader user={user} workspace={workspace} />

            <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col p-4 outline-none sm:p-6">
              {children}
            </main>
          </SidebarInset>

          <UploadManager />
        </SidebarProvider>
      </WorkspaceProvider>
    </CurrentUserProvider>
  )
}

function AppSidebar({
  user,
  workspace,
  usage,
}: {
  user: User
  workspace: Workspace
  usage: CurrentUserUsage
}) {
  const workspaceItems: NavItem[] = [
    { title: "Files", href: workspacePath(workspace.username), icon: FolderIcon, enabled: true, exact: true },
    { title: "Search", href: workspacePath(workspace.username, "search"), icon: SearchIcon, enabled: true },
    { title: "Favorites", href: workspacePath(workspace.username, "favorites"), icon: HeartIcon, enabled: true },
    { title: "Collections", href: workspacePath(workspace.username, "collections"), icon: LibraryIcon, enabled: true },
    { title: "Shared", href: workspacePath(workspace.username, "shared"), icon: Share2Icon, enabled: true },
    { title: "Trash", href: workspacePath(workspace.username, "trash"), icon: Trash2Icon, enabled: true },
  ]

  const managementItems: NavItem[] = [
    { title: "Admin", href: workspacePath(workspace.username, "admin"), icon: ShieldIcon, enabled: true, exact: true },
    { title: "Diagnostics", href: workspacePath(workspace.username, "admin/diagnostics"), icon: ActivityIcon, enabled: true },
  ]

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="DisCloud">
              <Link href={workspacePath(workspace.username)}>
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <CloudIcon className="size-4" />
                </div>

                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">DisCloud</span>
                  <span className="truncate text-xs text-muted-foreground">@{workspace.username}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <WorkspaceSwitcher />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>
            {workspace.username === user.username ? "Workspace" : `${workspace.name}'s workspace`}
          </SidebarGroupLabel>

          <SidebarGroupContent>
            <AppNav items={workspaceItems} />
          </SidebarGroupContent>
        </SidebarGroup>

        {user.role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>Management</SidebarGroupLabel>

            <SidebarGroupContent>
              <AppNav items={managementItems} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <QuotaUsage username={workspace.username} usage={usage} showOwner={workspace.username !== user.username} />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}

function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarMenu>
      {items.map((item) => {
        const active = item.exact ? pathname === item.href || pathname === `${item.href}/` : isActivePath(pathname, item.href)

        return (
          <SidebarMenuItem key={item.href}>
            {item.enabled ? (
              <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                <Link href={item.href} onClick={() => setOpenMobile(false)}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton aria-disabled className="cursor-not-allowed opacity-50" tooltip={`${item.title} · coming soon`}>
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

function AppHeader({ user, workspace }: { user: User; workspace: Workspace }) {
  const pathname = usePathname()
  const title = routeTitle(pathname, workspace.username)

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/75">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-8" />
        <span className="hidden max-w-40 truncate text-sm font-medium sm:inline lg:max-w-64">{title}</span>
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

function QuotaUsage({
  username,
  usage,
  showOwner,
}: {
  username: string
  usage: CurrentUserUsage
  showOwner: boolean
}) {
  const committed = usage.usedBytes + usage.reservedBytes
  const percent = usage.quotaBytes === null
    ? 0
    : Math.min(100, usage.quotaBytes === 0 ? 100 : committed / usage.quotaBytes * 100)

  return (
    <div className="mx-1 space-y-2 rounded-lg border bg-background p-2.5 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium">
          {showOwner ? `@${username} storage` : "Storage"}
        </span>

        {usage.quotaBytes !== null && (
          <span className="tabular-nums text-muted-foreground">{Math.round(percent)}%</span>
        )}
      </div>

      <div className="truncate text-xs tabular-nums text-muted-foreground">
        {formatBytes(usage.usedBytes)}
        {usage.reservedBytes > 0 && <span> (+{formatBytes(usage.reservedBytes)})</span>}
        <span> / {usage.quotaBytes === null ? "Unlimited" : formatBytes(usage.quotaBytes)}</span>
      </div>

      {usage.quotaBytes !== null && <Progress value={percent} />}
      {usage.overQuota && <div className="text-xs font-medium text-destructive">Quota exceeded</div>}
    </div>
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