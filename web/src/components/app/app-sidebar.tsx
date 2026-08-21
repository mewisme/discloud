"use client"

import { ActivityIcon, BotIcon, CloudIcon, FolderIcon, HeartIcon, LibraryIcon, SearchIcon, Share2Icon, ShieldIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ComponentType } from "react"

import type { Workspace } from "@/components/app/workspace-context"
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher"
import { Progress } from "@/components/ui/progress"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar } from "@/components/ui/sidebar"
import type { CurrentUserUsage, User } from "@/lib/api/models"
import { formatBytes, isActivePath } from "@/lib/helpers"
import { workspacePath } from "@/lib/workspace/navigation"

type NavItem = {
  title: string
  href: string
  icon: ComponentType<{ className?: string }>
  enabled: boolean
  exact?: boolean
}

export function AppSidebar({
  user,
  workspace,
  usage,
}: {
  user: User
  workspace: Workspace
  usage: CurrentUserUsage
}) {
  const workspaceItems: NavItem[] = [
    {
      title: "Files",
      href: workspacePath(workspace.username),
      icon: FolderIcon,
      enabled: true,
      exact: true,
    },
    {
      title: "Search",
      href: workspacePath(workspace.username, "search"),
      icon: SearchIcon,
      enabled: true,
    },
    {
      title: "Favorites",
      href: workspacePath(workspace.username, "favorites"),
      icon: HeartIcon,
      enabled: true,
    },
    {
      title: "Collections",
      href: workspacePath(workspace.username, "collections"),
      icon: LibraryIcon,
      enabled: true,
    },
    {
      title: "Shared",
      href: workspacePath(workspace.username, "shared"),
      icon: Share2Icon,
      enabled: true,
    },
    {
      title: "Trash",
      href: workspacePath(workspace.username, "trash"),
      icon: Trash2Icon,
      enabled: true,
    },
  ]

  const managementItems: NavItem[] = [
    {
      title: "Admin",
      href: workspacePath(user.username, "admin"),
      icon: ShieldIcon,
      enabled: true,
      exact: true,
    },
    {
      title: "Bots",
      href: workspacePath(user.username, "admin/bots"),
      icon: BotIcon,
      enabled: true,
    },
    {
      title: "Diagnostics",
      href: workspacePath(user.username, "admin/diagnostics"),
      icon: ActivityIcon,
      enabled: true,
    },
  ]

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="DisCloud">
              <Link href={workspacePath(user.username)}>
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <CloudIcon className="size-4" />
                </div>

                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">DisCloud</span>
                  <span className="truncate text-xs text-muted-foreground">
                    @{user.username}
                  </span>
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
            {workspace.username === user.username
              ? "Workspace"
              : `${workspace.name}'s workspace`}
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
        <QuotaUsage
          username={workspace.username}
          usage={usage}
          showOwner={workspace.username !== user.username}
        />
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
        const active = item.exact
          ? pathname === item.href || pathname === `${item.href}/`
          : isActivePath(pathname, item.href)

        return (
          <SidebarMenuItem key={item.href}>
            {item.enabled ? (
              <SidebarMenuButton
                asChild
                isActive={active}
                tooltip={item.title}
              >
                <Link
                  href={item.href}
                  onClick={() => setOpenMobile(false)}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                aria-disabled
                className="cursor-not-allowed opacity-50"
                tooltip={`${item.title} · coming soon`}
              >
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
    : Math.min(
      100,
      usage.quotaBytes === 0
        ? 100
        : committed / usage.quotaBytes * 100,
    )

  return (
    <div className="mx-1 space-y-2 rounded-lg border bg-background p-2.5 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium">
          {showOwner ? `@${username} storage` : "Storage"}
        </span>

        {usage.quotaBytes !== null && (
          <span className="tabular-nums text-muted-foreground">
            {Math.round(percent)}%
          </span>
        )}
      </div>

      <div className="truncate text-xs tabular-nums text-muted-foreground">
        {formatBytes(usage.usedBytes)}
        {usage.reservedBytes > 0 && (
          <span> (+{formatBytes(usage.reservedBytes)})</span>
        )}
        <span>
          {" "} / {usage.quotaBytes === null
            ? "Unlimited"
            : formatBytes(usage.quotaBytes)}
        </span>
      </div>

      {usage.quotaBytes !== null && <Progress value={percent} />}

      {usage.overQuota && (
        <div className="text-xs font-medium text-destructive">
          Quota exceeded
        </div>
      )}
    </div>
  )
}