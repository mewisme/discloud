import type { AdminUser, AdminUsers, ListUsersQuery, User, WorkspaceDetails } from "@discloud/api/models"
import { workspacePath, workspaceRelativePath } from "@discloud/shared/navigation"
import { Button } from "@discloud/ui/components/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@discloud/ui/components/command"
import { Popover, PopoverContent, PopoverTrigger } from "@discloud/ui/components/popover"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@discloud/ui/components/sidebar"
import { cn } from "@discloud/ui/lib/utils"
import { ArrowLeftIcon, CheckIcon, ChevronsUpDownIcon, FolderRootIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router"

import { apiJSON } from "#lib/api/transport"
import { errorMessage } from "#lib/instance"

import { loadDesktopWorkspace } from "../api"

const pageSize = 100

type AdminDirectoryUser = Pick<AdminUser, "id" | "username" | "name" | "role" | "status">

export function DesktopWorkspaceSwitcher({ currentUser, workspaceUsername, sidebarSide = "left" }: {
  currentUser: User
  workspaceUsername: string
  sidebarSide?: "left" | "right"
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceDetails["owner"]>()
  const [users, setUsers] = useState<AdminDirectoryUser[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [error, setError] = useState<string>()
  const viewingOtherWorkspace = currentUser.role === "admin" && workspaceUsername !== currentUser.username
  const workspaceName = workspace?.name ?? (workspaceUsername === currentUser.username ? currentUser.name : workspaceUsername)
  const orderedUsers = useMemo(() => [...users].sort((a, b) => {
    if (a.username === workspaceUsername) return -1
    if (b.username === workspaceUsername) return 1
    return a.name.localeCompare(b.name) || a.username.localeCompare(b.username)
  }), [users, workspaceUsername])

  useEffect(() => {
    let cancelled = false

    setWorkspace(undefined)

    void loadDesktopWorkspace(workspaceUsername)
      .then((details) => {
        if (!cancelled) setWorkspace(details.owner)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [workspaceUsername])

  useEffect(() => {
    if (!open || loaded || currentUser.role !== "admin") return

    let cancelled = false
    setLoading(true)
    setError(undefined)

    void listAdminUserDirectory()
      .then((items) => {
        if (cancelled) return
        setUsers(items.filter((user) => user.status === "active"))
        setLoaded(true)
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [currentUser.role, loaded, open, reloadVersion])

  function select(username: string) {
    if (username === workspaceUsername) {
      setOpen(false)
      return
    }

    const relative = workspaceRelativePath(location.pathname, workspaceUsername)
    const suffix = switchableWorkspaceSuffix(relative)
    const path = workspacePath(username, suffix)
    const preserveQuery = suffix === relative && location.search.length > 1

    setOpen(false)
    setOpenMobile(false)
    navigate(preserveQuery ? `${path}${location.search}` : path)
  }

  function returnToMyWorkspace() {
    setOpen(false)
    setOpenMobile(false)
    navigate(workspacePath(currentUser.username))
  }

  function retry() {
    setError(undefined)
    setLoaded(false)
    setReloadVersion((value) => value + 1)
  }

  if (currentUser.role !== "admin") {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" asChild tooltip={workspaceName}>
            <Link to={workspacePath(workspaceUsername)} onClick={() => setOpenMobile(false)}>
              <WorkspaceIcon />
              <WorkspaceLabel name={workspaceName} username={workspaceUsername} adminView={false} />
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={workspaceName} className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <WorkspaceIcon />
              <WorkspaceLabel name={workspaceName} username={workspaceUsername} adminView={viewingOtherWorkspace} />
              <ChevronsUpDownIcon className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </PopoverTrigger>

          <PopoverContent
            side={isMobile ? "bottom" : state === "collapsed" ? sidebarSide === "left" ? "right" : "left" : "bottom"}
            align="start"
            sideOffset={8}
            className="w-72 p-0"
          >
            <Command>
              <CommandInput placeholder="Search workspaces..." />

              <CommandList>
                {viewingOtherWorkspace ? (
                  <>
                    <CommandGroup heading="Current actor">
                      <CommandItem value={`return my workspace ${currentUser.name} ${currentUser.username}`} onSelect={returnToMyWorkspace}>
                        <ArrowLeftIcon />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">Return to my workspace</p>
                          <p className="truncate text-xs text-muted-foreground">{currentUser.name} · @{currentUser.username}</p>
                        </div>
                      </CommandItem>
                    </CommandGroup>
                    <CommandSeparator />
                  </>
                ) : null}

                {loading ? (
                  <CommandItem disabled>
                    <Loader2Icon className="animate-spin" />
                    Loading workspaces...
                  </CommandItem>
                ) : null}

                {error ? (
                  <div className="space-y-2 p-3">
                    <p className="text-sm text-destructive">{error}</p>
                    <Button size="sm" variant="outline" className="w-full" onClick={retry}>
                      <RefreshCwIcon />
                      Try again
                    </Button>
                  </div>
                ) : null}

                {!loading && loaded && !error ? <CommandEmpty>No workspace found.</CommandEmpty> : null}

                {!error ? (
                  <CommandGroup heading="Workspaces">
                    {orderedUsers.map((user) => (
                      <CommandItem key={user.id} value={`${user.name} ${user.username} ${user.role}`} onSelect={() => select(user.username)}>
                        <CheckIcon className={cn("size-4", user.username === workspaceUsername ? "opacity-100" : "opacity-0")} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{user.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            @{user.username} · <span className="capitalize">{user.role}</span>
                          </p>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function WorkspaceIcon() {
  return (
    <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
      <FolderRootIcon className="size-4" />
    </div>
  )
}

function WorkspaceLabel({ name, username, adminView }: { name: string; username: string; adminView: boolean }) {
  return (
    <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
      <span className="truncate font-semibold">{name}</span>
      <span className="truncate text-xs text-muted-foreground">
        @{username}{adminView ? " · Admin view" : ""}
      </span>
    </div>
  )
}

async function listAdminUserDirectory(): Promise<AdminDirectoryUser[]> {
  const users = new Map<string, AdminDirectoryUser>()
  let offset = 0

  while (true) {
    const query = { limit: pageSize, offset } satisfies ListUsersQuery
    const page = await apiJSON<AdminUsers>("/api/v1/admin/users", { query })

    for (const user of page.users) {
      users.set(user.id, {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        status: user.status,
      })
    }

    if (!page.users.length || page.offset + page.users.length >= page.total) break
    offset = page.offset + page.users.length
  }

  return [...users.values()]
}

function switchableWorkspaceSuffix(relative: string | null) {
  if (!relative || relative === "/") return "/"

  if (relative === "/search" || relative === "/favorites" || relative === "/shared" || relative === "/trash") return relative

  if (relative === "/collections" || relative.startsWith("/collections/")) return "/collections"

  return "/"
}