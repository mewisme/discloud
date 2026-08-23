"use client"

import { Button } from "@discloud/ui/components/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@discloud/ui/components/command"
import { Popover, PopoverContent, PopoverTrigger } from "@discloud/ui/components/popover"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@discloud/ui/components/sidebar"
import { cn } from "@discloud/ui/lib/utils"
import { ArrowLeftIcon, CheckIcon, ChevronsUpDownIcon, FolderRootIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { useCurrentUser } from "@/components/app/current-user-context"
import { useWorkspace } from "@/components/app/workspace-context"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"
import { type AdminDirectoryUser, listAdminUserDirectory } from "@/lib/users/admin-user-directory"
import { workspacePath, workspaceRelativePath } from "@/lib/workspace/navigation"

export function WorkspaceSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentUser = useCurrentUser()
  const workspace = useWorkspace()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<AdminDirectoryUser[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [error, setError] = useState<string>()
  const viewingOtherWorkspace =
    currentUser.role === "admin" &&
    workspace.username !== currentUser.username

  useEffect(() => {
    if (!open || loaded || currentUser.role !== "admin") return

    const controller = new AbortController()

    setLoading(true)
    setError(undefined)

    void listAdminUserDirectory(controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return

        setUsers(
          items
            .filter((user) => user.status === "active")
            .sort((a, b) => {
              if (a.id === workspace.id) return -1
              if (b.id === workspace.id) return 1
              return a.name.localeCompare(b.name)
            }),
        )
        setLoaded(true)
      })
      .catch((cause) => {
        if (controller.signal.aborted) return

        if (cause instanceof APIError && cause.status === 401) {
          router.replace("/login")
          router.refresh()
          return
        }

        setError(
          apiErrorMessage(
            cause,
            "Could not load workspaces",
          ),
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [
    currentUser.role,
    loaded,
    open,
    reloadVersion,
    router,
    workspace.id,
  ])

  function select(username: string) {
    if (username === workspace.username) {
      setOpen(false)
      return
    }

    const relative = workspaceRelativePath(
      pathname,
      workspace.username,
    )
    const suffix = switchableWorkspaceSuffix(relative)
    const path = workspacePath(username, suffix)
    const preserveQuery =
      suffix === relative &&
      searchParams.size > 0

    const href = preserveQuery
      ? `${path}?${searchParams.toString()}`
      : path

    setOpen(false)
    setOpenMobile(false)
    router.push(href)
  }

  function returnToMyWorkspace() {
    setOpen(false)
    setOpenMobile(false)
    router.push(
      workspacePath(currentUser.username),
    )
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
          <SidebarMenuButton
            size="lg"
            asChild
            tooltip={workspace.name}
          >
            <Link
              href={workspacePath(workspace.username)}
              onClick={() => setOpenMobile(false)}
            >
              <WorkspaceIcon />

              <WorkspaceLabel
                name={workspace.name}
                username={workspace.username}
                adminView={false}
              />
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Popover
          open={open}
          onOpenChange={setOpen}
        >
          <PopoverTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={workspace.name}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <WorkspaceIcon />

              <WorkspaceLabel
                name={workspace.name}
                username={workspace.username}
                adminView={viewingOtherWorkspace}
              />

              <ChevronsUpDownIcon className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </PopoverTrigger>

          <PopoverContent
            side={
              isMobile
                ? "bottom"
                : state === "collapsed"
                  ? "right"
                  : "bottom"
            }
            align="start"
            sideOffset={8}
            className="w-72 p-0"
          >
            <Command>
              <CommandInput placeholder="Search workspaces…" />

              <CommandList>
                {viewingOtherWorkspace && (
                  <>
                    <CommandGroup heading="Current actor">
                      <CommandItem
                        value={`return my workspace ${currentUser.name} ${currentUser.username}`}
                        onSelect={returnToMyWorkspace}
                      >
                        <ArrowLeftIcon />

                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            Return to my workspace
                          </p>

                          <p className="truncate text-xs text-muted-foreground">
                            {currentUser.name} · @{currentUser.username}
                          </p>
                        </div>
                      </CommandItem>
                    </CommandGroup>

                    <CommandSeparator />
                  </>
                )}

                {loading && (
                  <CommandItem disabled>
                    <Loader2Icon className="animate-spin" />
                    Loading workspaces…
                  </CommandItem>
                )}

                {error && (
                  <div className="space-y-2 p-3">
                    <p className="text-sm text-destructive">
                      {error}
                    </p>

                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={retry}
                    >
                      <RefreshCwIcon />
                      Try again
                    </Button>
                  </div>
                )}

                {!loading && loaded && !error && (
                  <CommandEmpty>
                    No workspace found.
                  </CommandEmpty>
                )}

                {!error && (
                  <CommandGroup heading="Workspaces">
                    {users.map((user) => (
                      <CommandItem
                        key={user.id}
                        value={`${user.name} ${user.username} ${user.role}`}
                        onSelect={() => select(user.username)}
                      >
                        <CheckIcon
                          className={cn(
                            "size-4",
                            user.id === workspace.id
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />

                        <div className="min-w-0 flex-1">
                          <p className="truncate">
                            {user.name}
                          </p>

                          <p className="truncate text-xs text-muted-foreground">
                            @{user.username} ·{" "}
                            <span className="capitalize">
                              {user.role}
                            </span>
                          </p>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
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

function WorkspaceLabel({
  name,
  username,
  adminView,
}: {
  name: string
  username: string
  adminView: boolean
}) {
  return (
    <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
      <span className="truncate font-semibold">
        {name}
      </span>

      <span className="truncate text-xs text-muted-foreground">
        @{username}
        {adminView && " · Admin view"}
      </span>
    </div>
  )
}

function switchableWorkspaceSuffix(
  relative: string | null,
) {
  if (!relative || relative === "/") {
    return "/"
  }

  if (
    relative === "/search" ||
    relative === "/favorites" ||
    relative === "/shared" ||
    relative === "/trash"
  ) {
    return relative
  }

  if (
    relative === "/collections" ||
    relative.startsWith("/collections/")
  ) {
    return "/collections"
  }

  return "/"
}