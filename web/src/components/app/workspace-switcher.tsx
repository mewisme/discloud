"use client"

import { ArrowLeftIcon, CheckIcon, ChevronsUpDownIcon, FolderRootIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { useCurrentUser } from "@/components/app/current-user-context"
import { useWorkspace } from "@/components/app/workspace-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useSidebar } from "@/components/ui/sidebar"
import { APIError } from "@/lib/api/types"
import { apiErrorMessage } from "@/lib/helpers"
import { type AdminDirectoryUser, listAdminUserDirectory } from "@/lib/users/admin-user-directory"
import { cn } from "@/lib/utils"
import { workspacePath, workspaceRelativePath } from "@/lib/workspace/navigation"

export function WorkspaceSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentUser = useCurrentUser()
  const workspace = useWorkspace()
  const { setOpenMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<AdminDirectoryUser[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [error, setError] = useState<string>()
  const viewingOtherWorkspace = currentUser.role === "admin" && workspace.username !== currentUser.username

  useEffect(() => {
    if (!open || loaded || currentUser.role !== "admin") return

    const controller = new AbortController()
    setLoading(true)
    setError(undefined)

    void listAdminUserDirectory(controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        setUsers(items.filter((user) => user.status === "active"))
        setLoaded(true)
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        if (cause instanceof APIError && cause.status === 401) {
          router.replace("/login")
          router.refresh()
          return
        }
        setError(apiErrorMessage(cause, "Could not load workspaces"))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [currentUser.role, loaded, open, reloadVersion, router])

  function select(username: string) {
    if (username === workspace.username) {
      setOpen(false)
      return
    }

    const relative = workspaceRelativePath(pathname, workspace.username)
    const suffix = switchableWorkspaceSuffix(relative)
    const path = workspacePath(username, suffix)
    const preserveQuery = suffix === relative && searchParams.size > 0
    const href = preserveQuery ? `${path}?${searchParams.toString()}` : path

    setOpen(false)
    setOpenMobile(false)
    router.push(href)
  }

  function returnToMyWorkspace() {
    setOpen(false)
    setOpenMobile(false)
    router.push(workspacePath(currentUser.username))
  }

  function retry() {
    setError(undefined)
    setLoaded(false)
    setReloadVersion((value) => value + 1)
  }

  if (currentUser.role !== "admin") {
    return (
      <div className="flex min-h-11 items-center gap-2 rounded-lg px-2 py-1.5 group-data-[collapsible=icon]:justify-center">
        <FolderRootIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <p className="truncate text-sm font-medium">{workspace.name}</p>
          <p className="truncate text-xs text-muted-foreground">@{workspace.username}</p>
        </div>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="h-auto min-h-11 w-full justify-start gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center">
          <FolderRootIcon className="size-4 shrink-0" />

          <div className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-medium">{workspace.name}</span>
              {viewingOtherWorkspace && (
                <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                  Admin view
                </Badge>
              )}
            </div>
            <span className="block truncate text-xs font-normal text-muted-foreground">@{workspace.username}</span>
          </div>

          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </Button>
      </PopoverTrigger>

      <PopoverContent side="right" align="start" sideOffset={8} className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search workspaces…" />

          <CommandList>
            {viewingOtherWorkspace && (
              <>
                <CommandGroup heading="Admin">
                  <CommandItem value={`return my workspace ${currentUser.name} ${currentUser.username}`} onSelect={returnToMyWorkspace}>
                    <ArrowLeftIcon />

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">Return to my workspace</p>
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
                <p className="text-sm text-destructive">{error}</p>
                <Button size="sm" variant="outline" className="w-full" onClick={retry}>
                  <RefreshCwIcon />
                  Try again
                </Button>
              </div>
            )}

            {!loading && !error && <CommandEmpty>No workspace found.</CommandEmpty>}

            {!error && (
              <CommandGroup heading="Workspaces">
                {users.map((user) => (
                  <CommandItem
                    key={user.id}
                    value={`${user.name} ${user.username} ${user.role}`}
                    onSelect={() => select(user.username)}
                  >
                    <CheckIcon className={cn("size-4", user.id === workspace.id ? "opacity-100" : "opacity-0")} />

                    <div className="min-w-0 flex-1">
                      <p className="truncate">{user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        @{user.username} · <span className="capitalize">{user.role}</span>
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
  )
}

function switchableWorkspaceSuffix(relative: string | null) {
  if (!relative || relative === "/") return "/"
  if (relative === "/search" || relative === "/favorites" || relative === "/shared" || relative === "/trash") return relative
  if (relative === "/collections" || relative.startsWith("/collections/")) return "/collections"
  return "/"
}