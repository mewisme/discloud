"use client"

import { ActivityIcon, BotIcon, ChevronRightIcon, FolderIcon, HeartIcon, LibraryIcon, SearchIcon, Share2Icon, ShieldIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { type ComponentType, useEffect, useState } from "react"

import type { Workspace } from "@/components/app/workspace-context"
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher"
import { useUserConfig } from "@/components/settings/user-config-context"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarRail, useSidebar } from "@/components/ui/sidebar"
import type { CurrentUserUsage, User } from "@/lib/api/models"
import { formatBytes, isActivePath } from "@/lib/helpers"
import { workspacePath } from "@/lib/workspace/navigation"

type NavItem = {
  title: string
  href: string
  icon: ComponentType<{ className?: string }>
  exact?: boolean
  match?: (pathname: string) => boolean
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
  const { config } = useUserConfig()
  const sidebar = config.common.sidebar
  const submenuSide = sidebar.side === "left" ? "right" : "left"
  const workspaceRoot = workspacePath(workspace.username)

  const primaryItems: NavItem[] = [
    {
      title: "Files",
      href: workspaceRoot,
      icon: FolderIcon,
      match: (pathname) =>
        pathname === workspaceRoot ||
        pathname === `${workspaceRoot}/` ||
        pathname.startsWith(`${workspaceRoot}/folders/`) ||
        pathname.startsWith(`${workspaceRoot}/files/`),
    },
    {
      title: "Search",
      href: workspacePath(workspace.username, "search"),
      icon: SearchIcon,
    },
  ]

  const libraryItems: NavItem[] = [
    {
      title: "Favorites",
      href: workspacePath(workspace.username, "favorites"),
      icon: HeartIcon,
    },
    {
      title: "Collections",
      href: workspacePath(workspace.username, "collections"),
      icon: LibraryIcon,
    },
    {
      title: "Shared",
      href: workspacePath(workspace.username, "shared"),
      icon: Share2Icon,
    },
    {
      title: "Trash",
      href: workspacePath(workspace.username, "trash"),
      icon: Trash2Icon,
    },
  ]

  const adminItems: NavItem[] = [
    {
      title: "Admin",
      href: workspacePath(user.username, "admin"),
      icon: ShieldIcon,
      exact: true,
    },
    {
      title: "Bots",
      href: workspacePath(user.username, "admin/bots"),
      icon: BotIcon,
    },
    {
      title: "Diagnostics",
      href: workspacePath(user.username, "admin/diagnostics"),
      icon: ActivityIcon,
    },
  ]

  return (
    <Sidebar
      side={sidebar.side}
      variant={sidebar.variant}
      collapsible={sidebar.collapsible}
    >
      <SidebarHeader>
        <WorkspaceSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              <AppNavItems items={primaryItems} />

              <GroupedNavItem
                title="Library"
                icon={LibraryIcon}
                items={libraryItems}
                dropdownSide={submenuSide}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {user.role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>

            <SidebarGroupContent>
              <SidebarMenu>
                <AppNavItems items={adminItems} />
              </SidebarMenu>
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

function AppNavItems({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()

  return items.map((item) => {
    const active = isNavItemActive(pathname, item)

    return (
      <SidebarMenuItem key={item.href}>
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
      </SidebarMenuItem>
    )
  })
}

function GroupedNavItem({
  title,
  icon: Icon,
  items,
  dropdownSide,
}: {
  title: string
  icon: ComponentType<{ className?: string }>
  items: NavItem[]
  dropdownSide: "left" | "right"
}) {
  const pathname = usePathname()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const active = items.some((item) => isNavItemActive(pathname, item))
  const [open, setOpen] = useState(active)

  useEffect(() => {
    if (active) setOpen(true)
  }, [active])

  if (state === "collapsed" && !isMobile) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              isActive={active}
              tooltip={title}
            >
              <Icon />
              <span>{title}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            side={dropdownSide}
            align="start"
            sideOffset={8}
            className="w-48"
          >
            {items.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href}>
                  <item.icon />
                  {item.title}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    )
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={active}
            tooltip={title}
          >
            <Icon />
            <span>{title}</span>

            <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map((item) => {
              const itemActive = isNavItemActive(pathname, item)

              return (
                <SidebarMenuSubItem key={item.href}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={itemActive}
                  >
                    <Link
                      href={item.href}
                      onClick={() => setOpenMobile(false)}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              )
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function isNavItemActive(pathname: string, item: NavItem) {
  if (item.match) return item.match(pathname)

  if (item.exact) {
    return pathname === item.href || pathname === `${item.href}/`
  }

  return isActivePath(pathname, item.href)
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

      {usage.quotaBytes !== null && (
        <Progress value={percent} />
      )}

      {usage.overQuota && (
        <div className="text-xs font-medium text-destructive">
          Quota exceeded
        </div>
      )}
    </div>
  )
}