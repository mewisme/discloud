"use client"

import { ActivityIcon, CloudIcon, FolderIcon, HeartIcon, LibraryIcon, SearchIcon, Share2Icon, ShieldIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ComponentType, ReactNode } from "react"

import { CommandPalette } from "@/components/app/command-palette"
import { CurrentUserProvider } from "@/components/app/current-user-context"
import { HeaderUserMenu } from "@/components/app/header-user-menu"
import { ModeToggle } from "@/components/app/mode-toggle"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import type { CurrentUserUsage, User } from "@/lib/api/models"
import { formatBytes, isActivePath } from "@/lib/helpers"

type NavItem = {
  title: string
  href: string
  icon: ComponentType<{ className?: string }>
  enabled: boolean
  exact?: boolean
}

const workspace: NavItem[] = [
  { title: "Files", href: "/files", icon: FolderIcon, enabled: true },
  { title: "Search", href: "/search", icon: SearchIcon, enabled: true },
  { title: "Favorites", href: "/favorites", icon: HeartIcon, enabled: true },
  { title: "Collections", href: "/collections", icon: LibraryIcon, enabled: true },
  { title: "Shared", href: "/shared", icon: Share2Icon, enabled: true },
  { title: "Trash", href: "/trash", icon: Trash2Icon, enabled: true },
]

const management: NavItem[] = [
  { title: "Admin", href: "/admin", icon: ShieldIcon, enabled: true, exact: true },
  { title: "Diagnostics", href: "/admin/diagnostics", icon: ActivityIcon, enabled: true },
]

const titles = [
  ["/settings/profile", "Profile"],
  ["/settings/security", "Security"],
  ["/settings/common", "Common"],
  ["/settings", "Settings"],
  ["/admin/diagnostics", "Diagnostics"],
  ["/collections", "Collections"],
  ["/favorites", "Favorites"],
  ["/shared", "Shared"],
  ["/search", "Search"],
  ["/trash", "Trash"],
  ["/admin", "Admin"],
  ["/files", "Files"],
] as const

export function AppShell({
  children,
  user,
  usage,
  defaultSidebarOpen,
}: {
  children: ReactNode
  user: User
  usage: CurrentUserUsage
  defaultSidebarOpen: boolean
}) {
  return (
    <CurrentUserProvider user={user}>
      <SidebarProvider defaultOpen={defaultSidebarOpen}>
        <Button asChild size="sm" variant="secondary" className="fixed left-3 top-3 z-50 -translate-y-20 shadow-lg transition-transform focus:translate-y-0">
          <Link href="#main-content">Skip to content</Link>
        </Button>

        <AppSidebar user={user} usage={usage} />

        <SidebarInset>
          <AppHeader user={user} />

          <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col p-4 outline-none sm:p-6">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </CurrentUserProvider>
  )
}

function AppSidebar({ user, usage }: { user: User; usage: CurrentUserUsage }) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="DisCloud">
              <Link href="/files">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <CloudIcon className="size-4" />
                </div>

                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">DisCloud</span>
                  <span className="truncate text-xs text-muted-foreground">File storage</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>

          <SidebarGroupContent>
            <AppNav items={workspace} />
          </SidebarGroupContent>
        </SidebarGroup>

        {user.role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>Management</SidebarGroupLabel>

            <SidebarGroupContent>
              <AppNav items={management} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <QuotaUsage usage={usage} />
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
        const active = item.exact ? pathname === item.href : isActivePath(pathname, item.href)

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

function AppHeader({ user }: { user: User }) {
  const pathname = usePathname()
  const title = titles.find(([path]) => pathname === path || pathname.startsWith(`${path}/`))?.[1] ?? "DisCloud"

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/75">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-5" />
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

function QuotaUsage({ usage }: { usage: CurrentUserUsage }) {
  const committed = usage.usedBytes + usage.reservedBytes
  const percent = usage.quotaBytes === null
    ? 0
    : Math.min(100, usage.quotaBytes === 0 ? 100 : committed / usage.quotaBytes * 100)

  return (
    <div className="mx-1 space-y-2 rounded-lg border bg-background p-2.5 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">Storage</span>
        {usage.quotaBytes !== null && (
          <span className="tabular-nums text-muted-foreground">
            {Math.round(percent)}%
          </span>
        )}
      </div>

      <div className="truncate text-xs tabular-nums text-muted-foreground">
        {formatBytes(usage.usedBytes)}
        {usage.reservedBytes > 0 && <span> (+{formatBytes(usage.reservedBytes)})</span>}
        <span> / {usage.quotaBytes === null ? "∞" : formatBytes(usage.quotaBytes)}</span>
      </div>

      {usage.quotaBytes !== null && <Progress value={percent} />}
      {usage.overQuota && <div className="text-xs font-medium text-destructive">Quota exceeded</div>}
    </div>
  )
}