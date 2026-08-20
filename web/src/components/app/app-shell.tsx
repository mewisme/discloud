"use client"

import type { ComponentType, ReactNode } from "react"
import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTheme } from "next-themes"
import { ActivityIcon, ChevronsUpDownIcon, CloudIcon, FolderIcon, HeartIcon, LibraryIcon, Loader2Icon, LogOutIcon, MonitorIcon, MoonIcon, SearchIcon, SettingsIcon, Share2Icon, ShieldIcon, SunIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { apiJSON } from "@/lib/api/client"
import type { CurrentUserUsage, User } from "@/lib/api/models"
import { formatBytes, initials, isActivePath } from "@/lib/helpers"

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
  { title: "Favorites", href: "/favorites", icon: HeartIcon, enabled: false },
  { title: "Collections", href: "/collections", icon: LibraryIcon, enabled: true },
  { title: "Shared", href: "/shared", icon: Share2Icon, enabled: true },
  { title: "Trash", href: "/trash", icon: Trash2Icon, enabled: true },
]

const management: NavItem[] = [
  { title: "Admin", href: "/admin", icon: ShieldIcon, enabled: true, exact: true },
  { title: "Diagnostics", href: "/admin/diagnostics", icon: ActivityIcon, enabled: true },
]

const titles = [
  ["/settings/security", "Security"],
  ["/admin/diagnostics", "Diagnostics"],
  ["/collections", "Collections"],
  ["/shared", "Shared"],
  ["/search", "Search"],
  ["/trash", "Trash"],
  ["/admin", "Admin"],
  ["/files", "Files"],
] as const

export function AppShell({ children, user, usage, defaultSidebarOpen }: { children: ReactNode; user: User; usage: CurrentUserUsage; defaultSidebarOpen: boolean }) {
  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <AppSidebar user={user} usage={usage} />
      <SidebarInset>
        <AppHeader />
        <div className="flex flex-1 flex-col p-4 sm:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
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
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu user={user} />
          </SidebarMenuItem>
        </SidebarMenu>
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

function AppHeader() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const title = titles.find(([path]) => pathname === path || pathname.startsWith(`${path}/`))?.[1] ?? "DisCloud"
  const searchValue = pathname === "/search" ? searchParams.get("q") ?? "" : ""

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/75 sm:px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-full" />
      <span className="hidden shrink-0 text-sm font-medium sm:inline">{title}</span>
      <form action="/search" className="relative ml-auto w-full max-w-sm">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input key={searchValue} name="q" defaultValue={searchValue} maxLength={256} placeholder="Search…" className="h-8 pl-8" />
      </form>
    </header>
  )
}

function UserMenu({ user }: { user: User }) {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const { isMobile, setOpenMobile } = useSidebar()
  const [pending, setPending] = useState(false)

  async function logout() {
    setPending(true)

    try {
      await apiJSON<void>("/auth/logout", { method: "POST" })
      setOpenMobile(false)
      router.replace("/login")
      router.refresh()
    } catch {
      toast.error("Could not sign out")
      setPending(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" tooltip={user.username} className="border">
          <Avatar className="size-8 rounded-full">
            <AvatarFallback className="rounded-full">{initials(user.username)}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{user.username}</span>
            <span className="truncate text-xs capitalize text-muted-foreground">{user.role}</span>
          </div>
          <ChevronsUpDownIcon className="ml-auto" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" sideOffset={8} className="min-w-56">
        <DropdownMenuLabel>
          <div className="flex items-center gap-2">
            <Avatar className="size-8 rounded-full">
              <AvatarFallback className="rounded-full">{initials(user.username)}</AvatarFallback>
            </Avatar>
            <div className="grid text-left text-sm leading-tight">
              <span className="truncate font-medium text-foreground">{user.username}</span>
              <span className="truncate text-xs capitalize">{user.role}</span>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings/security" onClick={() => setOpenMobile(false)}>
            <SettingsIcon />
            Security
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === "dark" ? <MoonIcon /> : theme === "light" ? <SunIcon /> : <MonitorIcon />}
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="system">
                <MonitorIcon />
                System
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">
                <SunIcon />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <MoonIcon />
                Dark
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" disabled={pending} onSelect={(event) => {
          event.preventDefault()
          void logout()
        }}>
          {pending ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function QuotaUsage({ usage }: { usage: CurrentUserUsage }) {
  const committed = usage.usedBytes + usage.reservedBytes
  const percent = usage.quotaBytes === null ? 0 : Math.min(100, usage.quotaBytes === 0 ? 100 : committed / usage.quotaBytes * 100)

  return (
    <div className="mx-1 space-y-2 rounded-lg border bg-background p-2.5 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">Storage</span>
        {usage.quotaBytes !== null && <span className="tabular-nums text-muted-foreground">{Math.round(percent)}%</span>}
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